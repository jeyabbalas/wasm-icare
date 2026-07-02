import { describe, expect, test } from 'vitest';

import type { AbsoluteRiskResult } from '../../../src/api/types';
import { loadICARE } from '../../../src/index.browser';
import { PYICARE_WHEEL_FILENAME } from '../../../src/runtime/config';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { summarizeDistribution } from '../../helpers/summarize';
import { ATOL_DETERMINISTIC, ATOL_DISTRIBUTION, DIST_KEYS } from '../../helpers/tolerances';

/**
 * Phase 7 milestone — the browser path, in a real headless Chromium. Pyodide is
 * self-hosted from the served `/pyodide/` mirror; the pyicare wheel and BPC3
 * fixtures are served too (see vitest.config.ts). The same BPC3 covariate-only
 * case runs via the module worker (`useWorker:true`) AND in-process
 * (`useWorker:false`); both match the R-derived golden, and the worker result's
 * buffer arrives transferred (a standalone Float64Array).
 */

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
  reference_risk_summary: Record<string, number>;
}

const INDEX_URL = '/pyodide/';
const WHEEL_URL = `/wheels/${PYICARE_WHEEL_FILENAME}`;
// The BUILT worker bundle, served statically (see vitest.config.ts). Using the
// production artifact avoids the dev server's module-worker transform (whose
// dynamic-import wrapper is absent in a raw worker) and exercises what ships.
const WORKER_URL = '/dist/worker.js';

const bpc3 = (file: string) => ({ url: `/fixtures/bpc3/${file}` });

function modelArgs(golden: CovariateGolden) {
  return {
    applyAgeStart: golden.age_start,
    applyAgeIntervalLength: golden.age_interval_length,
    modelDiseaseIncidenceRates: bpc3('age_specific_breast_cancer_incidence_rates.csv'),
    modelCompetingIncidenceRates: bpc3('age_specific_all_cause_mortality_rates.csv'),
    modelCovariateFormula: bpc3('breast_cancer_covariate_model_formula.txt'),
    modelLogRelativeRisk: bpc3('breast_cancer_model_log_odds_ratios.json'),
    modelReferenceDataset: bpc3('reference_covariate_data.csv'),
    applyCovariateProfile: bpc3('query_covariate_profile.csv'),
    returnLinearPredictors: true,
    returnReferenceRisks: true,
  };
}

async function fetchGolden(): Promise<CovariateGolden> {
  const response = await fetch('/golden/bpc3_covariate_only.json');
  return response.json() as Promise<CovariateGolden>;
}

function assertMatchesGolden(result: AbsoluteRiskResult, golden: CovariateGolden): void {
  const risks = result.profile.columns.risk_estimates as Float64Array;
  expect(risks).toBeInstanceOf(Float64Array);
  assertAllClose(risks, golden.risks, ATOL_DETERMINISTIC);
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
}

describe('BPC3 compute_absolute_risk in the browser', () => {
  test('via a module worker (useWorker:true): risks match the golden; the result buffer is transferred', async () => {
    const golden = await fetchGolden();
    const icare = await loadICARE({
      indexURL: INDEX_URL,
      pyicareWheelUrl: WHEEL_URL,
      workerUrl: WORKER_URL,
      useWorker: true,
    });
    try {
      const result = await icare.computeAbsoluteRisk(modelArgs(golden));
      assertMatchesGolden(result, golden);
      // A transferred buffer arrives as a standalone Float64Array (byteOffset 0, own full buffer).
      const risks = result.profile.columns.risk_estimates as Float64Array;
      expect(risks.byteOffset).toBe(0);
      expect(risks.buffer.byteLength).toBe(risks.length * 8);
    } finally {
      await icare.close();
    }
  });

  test('in-process (useWorker:false): matches the same golden', async () => {
    const golden = await fetchGolden();
    const icare = await loadICARE({
      indexURL: INDEX_URL,
      pyicareWheelUrl: WHEEL_URL,
      useWorker: false,
    });
    try {
      assertMatchesGolden(await icare.computeAbsoluteRisk(modelArgs(golden)), golden);
    } finally {
      await icare.close();
    }
  });
});
