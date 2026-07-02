import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createICARE } from '../../../src/api/icareFacade';
import type { AbsoluteRiskModelHandle, ColumnarTable, ICARE } from '../../../src/api/types';
import { createNodeMaterializer } from '../../../src/io/materialize-node';
import { bootstrapNodeEngine, type Engine } from '../../../src/index.node';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { csvToColumns } from '../../helpers/columns';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { summarizeDistribution } from '../../helpers/summarize';
import { ATOL_DETERMINISTIC, ATOL_DISTRIBUTION, DIST_KEYS } from '../../helpers/tolerances';

/**
 * Phase 6 — the fit-once "build model → apply many" path. Builds a BPC3 covariate model ONCE and:
 *   (a) applying the 3-row query profile equals a one-shot computeAbsoluteRisk (and the golden);
 *   (b) applyBatches over the 14,137-row reference-as-profile equals a single whole-table apply and
 *       reproduces the golden reference-risk distribution;
 *   (c) streaming a tiled ~113k-row synthetic keeps the WASM heap at a steady state (peak set by the
 *       batch size, not the total rows), while every tile reproduces the reference risks.
 *
 * Uses bootstrapNodeEngine + createICARE directly (rather than loadICARE) so the test can read the raw
 * WASM heap via engine.heapBytes() for the watermark assertion.
 */

const TILES = 8; // 8 × 14,137 ≈ 113k synthetic rows for the streaming/heap test

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
  reference_risk_summary: Record<string, number>;
}

const modelArgs = {
  modelDiseaseIncidenceRates: { path: bpc3('age_specific_breast_cancer_incidence_rates.csv') },
  modelCompetingIncidenceRates: { path: bpc3('age_specific_all_cause_mortality_rates.csv') },
  modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
  modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
  modelReferenceDataset: { path: bpc3('reference_covariate_data.csv') },
} as const;

/** Concatenate per-batch risk buffers into one Float64Array (order-preserving). */
function concatFloat64(chunks: Float64Array[]): Float64Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float64Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Repeat every column `times` over (dropping `drop` columns) to synthesize a larger table. */
function tileColumns(table: ColumnarTable, times: number, drop: string[] = []): ColumnarTable {
  const columns: ColumnarTable['columns'] = {};
  for (const [name, col] of Object.entries(table.columns)) {
    if (drop.includes(name)) continue;
    if (col instanceof Float64Array) {
      const out = new Float64Array(col.length * times);
      for (let t = 0; t < times; t += 1) out.set(col, t * col.length);
      columns[name] = out;
    } else {
      const base = col as Array<number | string>;
      const out = new Array<number | string>(base.length * times);
      for (let t = 0; t < times; t += 1) {
        for (let i = 0; i < base.length; i += 1) out[t * base.length + i] = base[i]!;
      }
      columns[name] = out as number[] | string[];
    }
  }
  return { columns };
}

describe('BPC3 build-once / apply-many (fit/apply split)', () => {
  let engine: Engine;
  let icare: ICARE;
  let model: AbsoluteRiskModelHandle;
  let golden: CovariateGolden;
  let referenceColumns: ColumnarTable;
  let wholeReferenceRisks: Float64Array;

  beforeAll(async () => {
    engine = await bootstrapNodeEngine();
    icare = createICARE(engine, createNodeMaterializer(engine));
    golden = loadGolden<CovariateGolden>('bpc3_covariate_only.json');

    // Fit ONCE — the reference dataset is read a single time here.
    model = await icare.buildAbsoluteRiskModel(modelArgs);

    // The 14,137-row reference fed back as a covariate profile (same schema). Its per-row risks equal
    // the reference-population risks, so the whole-table apply is the oracle for the batched runs.
    referenceColumns = csvToColumns(bpc3('reference_covariate_data.csv'));
    const whole = await model.apply({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      applyCovariateProfile: referenceColumns,
    });
    wholeReferenceRisks = whole.profile.columns.risk_estimates as Float64Array;
  }, 300_000);

  afterAll(async () => {
    await model?.free();
    await icare?.close();
  });

  test('apply on one built model equals a one-shot computeAbsoluteRisk and the golden', async () => {
    const applied = await model.apply({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      applyCovariateProfile: { path: bpc3('query_covariate_profile.csv') },
      returnLinearPredictors: true,
      returnReferenceRisks: true,
    });

    const singleShot = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      ...modelArgs,
      applyCovariateProfile: { path: bpc3('query_covariate_profile.csv') },
      returnLinearPredictors: true,
      returnReferenceRisks: true,
    });

    const appliedRisks = applied.profile.columns.risk_estimates as Float64Array;
    const appliedLps = applied.profile.columns.linear_predictors as Float64Array;

    // build-once + apply == single-shot compute, and both == the R-derived golden.
    assertAllClose(appliedRisks, singleShot.profile.columns.risk_estimates as Float64Array, ATOL_DETERMINISTIC);
    assertAllClose(appliedRisks, golden.risks, ATOL_DETERMINISTIC);
    assertAllClose(appliedLps, golden.linear_predictors, ATOL_DETERMINISTIC);
    // The fitted betas from build == the one-shot model betas.
    expect(model.model).toEqual(singleShot.model);
    expect(applied.model).toEqual(singleShot.model);
  }, 300_000);

  test('applyBatches over the reference profile equals the whole-table apply and the golden distribution', async () => {
    const chunks: Float64Array[] = [];
    for await (const batch of model.applyBatches(referenceColumns, {
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      batchRows: 5000,
    })) {
      chunks.push(batch.riskEstimates);
    }
    const streamed = concatFloat64(chunks);

    // 14,137 rows in 5,000-row batches => 3 batches, order-preserving, identical to one whole apply.
    expect(chunks.length).toBe(3);
    expect(streamed.length).toBe(wholeReferenceRisks.length);
    assertAllClose(streamed, wholeReferenceRisks, ATOL_DETERMINISTIC);

    // The reference-as-profile risks reproduce the golden reference-population risk distribution.
    expect(wholeReferenceRisks.length).toBe(golden.reference_risk_summary.n);
    assertDistributionClose(
      summarizeDistribution(wholeReferenceRisks),
      golden.reference_risk_summary,
      ATOL_DISTRIBUTION,
      DIST_KEYS,
    );
  }, 300_000);

  test('streaming a tiled ~113k-row synthetic stays under a bounded heap watermark', async () => {
    const tiled = tileColumns(referenceColumns, TILES, ['id']); // drop id => clean RangeIndex, no dup labels
    const batchRows = 25_000;

    const heapBaseline = engine.heapBytes();
    const chunks: Float64Array[] = [];
    const heapsAfterBatch: number[] = [];
    for await (const batch of model.applyBatches(tiled, {
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      batchRows,
    })) {
      chunks.push(batch.riskEstimates);
      heapsAfterBatch.push(engine.heapBytes());
    }
    const streamed = concatFloat64(chunks);

    // Correctness at scale: each tile repeats the reference, so every tile's risks == the 14k oracle.
    expect(streamed.length).toBe(TILES * wholeReferenceRisks.length);
    for (let t = 0; t < TILES; t += 1) {
      const slice = streamed.subarray(t * wholeReferenceRisks.length, (t + 1) * wholeReferenceRisks.length);
      assertAllClose(slice, wholeReferenceRisks, ATOL_DETERMINISTIC);
    }

    // Bounded memory: once a batch-sized working set is allocated the heap reaches steady state, so the
    // second half of the stream grows the heap by ~0 — peak memory tracks batchRows, NOT total rows.
    expect(heapsAfterBatch.length).toBeGreaterThanOrEqual(4);
    const mid = Math.floor(heapsAfterBatch.length / 2);
    const tailGrowth = heapsAfterBatch[heapsAfterBatch.length - 1]! - heapsAfterBatch[mid]!;
    const firstBatchGrowth = heapsAfterBatch[0]! - heapBaseline;
    expect(tailGrowth).toBeLessThanOrEqual(Math.max(firstBatchGrowth, 0));
    expect(tailGrowth).toBeLessThan(8 * 1024 * 1024); // < 8 MB tail growth across the second half
  }, 600_000);
});
