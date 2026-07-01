import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadICARE } from '../../../src/index.node';
import type { ICARE } from '../../../src/index.node';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { summarizeDistribution } from '../../helpers/summarize';
import {
  ATOL_DETERMINISTIC,
  ATOL_DISTRIBUTION,
  DIST_KEYS,
} from '../../helpers/tolerances';

/**
 * Phase 3 milestone — the first real end-to-end compute. Mirrors py-icare's
 * `tests/test_bpc3_cross_validation.test_covariate_only`: feed the BPC3
 * covariate-only case as `{ path }` inputs through the full slice
 * (JS -> Pyodide FS -> py-icare read_csv -> output_format='dataframe' ->
 * columnarize -> getBuffer typed arrays) and assert against the R-derived golden.
 */

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
  reference_risk_summary: Record<string, number>;
}

describe('BPC3 compute_absolute_risk (covariate-only)', () => {
  let icare: ICARE;

  beforeAll(async () => {
    icare = await loadICARE();
  });

  afterAll(async () => {
    await icare?.close();
  });

  test('per-subject risks + linear predictors + reference distribution match the golden', async () => {
    const golden = loadGolden<CovariateGolden>('bpc3_covariate_only.json');

    const result = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      modelDiseaseIncidenceRates: {
        path: bpc3('age_specific_breast_cancer_incidence_rates.csv'),
      },
      modelCompetingIncidenceRates: {
        path: bpc3('age_specific_all_cause_mortality_rates.csv'),
      },
      modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
      modelReferenceDataset: { path: bpc3('reference_covariate_data.csv') },
      applyCovariateProfile: { path: bpc3('query_covariate_profile.csv') },
      returnLinearPredictors: true,
      returnReferenceRisks: true,
    });

    // Deterministic per-subject outputs are columns of `profile`.
    const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
    const linearPredictors = result.profile.columns.linear_predictors as Float64Array;
    expect(riskEstimates).toBeInstanceOf(Float64Array);
    assertAllClose(riskEstimates, golden.risks, ATOL_DETERMINISTIC);
    assertAllClose(linearPredictors, golden.linear_predictors, ATOL_DETERMINISTIC);

    // Reference-population risk distribution (stable summary stats).
    expect(result.referenceRisks).toBeDefined();
    const populationRisks = result.referenceRisks?.[0]?.populationRisks;
    expect(populationRisks).toBeInstanceOf(Float64Array);
    expect(populationRisks?.length).toBe(golden.reference_risk_summary.n);
    const summary = summarizeDistribution(populationRisks as Float64Array);
    assertDistributionClose(
      summary,
      golden.reference_risk_summary,
      ATOL_DISTRIBUTION,
      DIST_KEYS,
    );
  });
});
