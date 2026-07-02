import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadICARE, type ICARE } from '../../../src/index.node';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { summarizeDistribution } from '../../helpers/summarize';
import { ATOL_DETERMINISTIC, ATOL_DISTRIBUTION, DIST_KEYS } from '../../helpers/tolerances';

/**
 * Phase 7 — the Node `worker_threads` opt-in, on a REAL second thread. Spawns the
 * built `dist/nodeWorker.js` (which boots its own Pyodide) and drives a BPC3 compute
 * over RPC; the numbers must equal the golden, proving the same host/transport code
 * works across a true thread boundary (the always-on MessageChannel e2e covers the
 * protocol itself). Requires a prior `npm run build`; skipped if the artifact is
 * absent so the slow suite still runs elsewhere.
 */

const distWorkerUrl = new URL('../../../dist/nodeWorker.js', import.meta.url);
const built = existsSync(fileURLToPath(distWorkerUrl));
if (!built) {
  console.warn('[worker_threads.slow] dist/nodeWorker.js not found — run `npm run build`; skipping.');
}

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
  reference_risk_summary: Record<string, number>;
}

describe.skipIf(!built)('BPC3 over a real worker_threads worker (useWorker:true)', () => {
  let icare: ICARE;

  beforeAll(async () => {
    icare = await loadICARE({ useWorker: true, workerUrl: distWorkerUrl });
  });

  afterAll(async () => {
    // close() releases the remote engine then terminates the worker thread.
    await icare?.close();
  });

  test('worker-thread risks + linear predictors + reference distribution match the golden', async () => {
    const golden = loadGolden<CovariateGolden>('bpc3_covariate_only.json');
    const result = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      modelDiseaseIncidenceRates: { path: bpc3('age_specific_breast_cancer_incidence_rates.csv') },
      modelCompetingIncidenceRates: { path: bpc3('age_specific_all_cause_mortality_rates.csv') },
      modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
      modelReferenceDataset: { path: bpc3('reference_covariate_data.csv') },
      applyCovariateProfile: { path: bpc3('query_covariate_profile.csv') },
      returnLinearPredictors: true,
      returnReferenceRisks: true,
    });

    const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
    expect(riskEstimates).toBeInstanceOf(Float64Array);
    assertAllClose(riskEstimates, golden.risks, ATOL_DETERMINISTIC);
    assertAllClose(
      result.profile.columns.linear_predictors as Float64Array,
      golden.linear_predictors,
      ATOL_DETERMINISTIC,
    );

    const populationRisks = result.referenceRisks?.[0]?.populationRisks as Float64Array;
    expect(populationRisks.length).toBe(golden.reference_risk_summary.n);
    assertDistributionClose(
      summarizeDistribution(populationRisks),
      golden.reference_risk_summary,
      ATOL_DISTRIBUTION,
      DIST_KEYS,
    );
  });
});
