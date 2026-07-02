import { MessageChannel } from 'node:worker_threads';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createICARE } from '../../../src/api/icareFacade';
import type { ICARE } from '../../../src/api/types';
import { bootstrapNodeEngine, type Engine } from '../../../src/index.node';
import { createNodeMaterializer } from '../../../src/io/materialize-node';
import { createInProcessClient, createWorkerClient } from '../../../src/worker/transport';
import { serveEngine } from '../../../src/worker/host';
import { nodePort } from '../../../src/worker/rpc';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { summarizeDistribution } from '../../helpers/summarize';
import { ATOL_DETERMINISTIC, ATOL_DISTRIBUTION, DIST_KEYS } from '../../helpers/tolerances';

/**
 * Phase 7 — the RPC transport, exercised OFFLINE in Node. A real `MessageChannel`
 * carries requests to a `serveEngine` host (wrapping a real Pyodide engine) and
 * marshalled results back; the facade is built over the worker client exactly as
 * the browser default does. This proves the full envelope / transferable / error
 * serde / writeInputFile-over-RPC path without a browser, and that the worker path
 * is byte-identical to the in-process path.
 */

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
  reference_risk_summary: Record<string, number>;
}

const bpc3Args = () => ({
  modelDiseaseIncidenceRates: { path: bpc3('age_specific_breast_cancer_incidence_rates.csv') },
  modelCompetingIncidenceRates: { path: bpc3('age_specific_all_cause_mortality_rates.csv') },
  modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
  modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
  modelReferenceDataset: { path: bpc3('reference_covariate_data.csv') },
  applyCovariateProfile: { path: bpc3('query_covariate_profile.csv') },
  returnLinearPredictors: true,
  returnReferenceRisks: true,
});

describe('BPC3 compute over the worker RPC transport (MessageChannel)', () => {
  let engine: Engine;
  let channel: MessageChannel;
  let icareWorker: ICARE;
  let icareLocal: ICARE;

  beforeAll(async () => {
    engine = await bootstrapNodeEngine();

    // Host the SAME engine behind an RPC port; the client drives it over the channel.
    channel = new MessageChannel();
    serveEngine(nodePort(channel.port2), async () => engine);
    const workerClient = await createWorkerClient(nodePort(channel.port1), {});
    icareWorker = createICARE(workerClient, createNodeMaterializer(workerClient));

    const localClient = createInProcessClient(engine);
    icareLocal = createICARE(localClient, createNodeMaterializer(localClient));
  });

  afterAll(async () => {
    // Closing the worker client sends `close` over RPC (releasing the engine) then
    // terminates port1; close port2 too so the channel does not keep the loop alive.
    await icareWorker?.close();
    channel?.port2.close();
  });

  test('worker-path risks + linear predictors + reference distribution match the golden', async () => {
    const golden = loadGolden<CovariateGolden>('bpc3_covariate_only.json');
    const result = await icareWorker.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      ...bpc3Args(),
    });

    const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
    const linearPredictors = result.profile.columns.linear_predictors as Float64Array;
    // A faithful transfer arrives as a standalone Float64Array (byteOffset 0, own buffer).
    expect(riskEstimates).toBeInstanceOf(Float64Array);
    expect(riskEstimates.byteOffset).toBe(0);
    expect(riskEstimates.buffer.byteLength).toBe(riskEstimates.length * 8);

    assertAllClose(riskEstimates, golden.risks, ATOL_DETERMINISTIC);
    assertAllClose(linearPredictors, golden.linear_predictors, ATOL_DETERMINISTIC);

    const populationRisks = result.referenceRisks?.[0]?.populationRisks;
    expect(populationRisks).toBeInstanceOf(Float64Array);
    expect(populationRisks?.length).toBe(golden.reference_risk_summary.n);
    assertDistributionClose(
      summarizeDistribution(populationRisks as Float64Array),
      golden.reference_risk_summary,
      ATOL_DISTRIBUTION,
      DIST_KEYS,
    );
  });

  test('worker path is byte-identical to the in-process path', async () => {
    const golden = loadGolden<CovariateGolden>('bpc3_covariate_only.json');
    const args = { applyAgeStart: golden.age_start, applyAgeIntervalLength: golden.age_interval_length };

    const viaWorker = await icareWorker.computeAbsoluteRisk({ ...args, ...bpc3Args() });
    const viaLocal = await icareLocal.computeAbsoluteRisk({ ...args, ...bpc3Args() });

    expect(Array.from(viaWorker.profile.columns.risk_estimates as Float64Array)).toEqual(
      Array.from(viaLocal.profile.columns.risk_estimates as Float64Array),
    );
    expect(Array.from(viaWorker.profile.columns.linear_predictors as Float64Array)).toEqual(
      Array.from(viaLocal.profile.columns.linear_predictors as Float64Array),
    );
    expect(viaWorker.model).toEqual(viaLocal.model);
  });
});
