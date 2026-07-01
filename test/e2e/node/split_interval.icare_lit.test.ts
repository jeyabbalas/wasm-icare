import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadICARE } from '../../../src/index.node';
import type { ICARE } from '../../../src/index.node';
import { assertAllClose } from '../../helpers/assert';
import { icareLit } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { ATOL_DETERMINISTIC } from '../../helpers/tolerances';

/**
 * Mirrors py-icare `tests/test_icare_lit_cross_validation.test_split_interval`:
 * the lt50 sub-model before the age-50 cutpoint, ge50 after (the ge50 side
 * exercises the HRT × BMI interaction). No SNP component → deterministic (1e-5).
 */

interface SplitGolden {
  age_start: number;
  age_interval_length: number;
  cutpoint: number;
  risks: number[];
}

describe('iCARE-Lit compute_absolute_risk_split_interval', () => {
  let icare: ICARE;

  beforeAll(async () => {
    icare = await loadICARE();
  });

  afterAll(async () => {
    await icare?.close();
  });

  test('lt50 before / ge50 after cutpoint: combined risks match the golden (deterministic)', async () => {
    const golden = loadGolden<SplitGolden>('icare_lit_split_interval.json');

    const result = await icare.computeAbsoluteRiskSplitInterval({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      cutpoint: golden.cutpoint,
      modelDiseaseIncidenceRates: { path: icareLit('age_specific_breast_cancer_incidence_rates.csv') },
      modelCompetingIncidenceRates: { path: icareLit('age_specific_all_cause_mortality_rates.csv') },
      modelCovariateFormulaBeforeCutpoint: { path: icareLit('model_formula_lt50.txt') },
      modelCovariateFormulaAfterCutpoint: { path: icareLit('model_formula_ge50.txt') },
      modelLogRelativeRiskBeforeCutpoint: { path: icareLit('model_log_odds_ratios_lt50.json') },
      modelLogRelativeRiskAfterCutpoint: { path: icareLit('model_log_odds_ratios_ge50.json') },
      modelReferenceDatasetBeforeCutpoint: { path: icareLit('reference_covariate_data_lt50.csv') },
      modelReferenceDatasetAfterCutpoint: { path: icareLit('reference_covariate_data_ge50.csv') },
      applyCovariateProfileBeforeCutpoint: { path: icareLit('icare_lit_query_lt50.csv') },
      applyCovariateProfileAfterCutpoint: { path: icareLit('icare_lit_query_ge50.csv') },
    });

    const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
    expect(riskEstimates).toBeInstanceOf(Float64Array);
    expect(riskEstimates.length).toBe(golden.risks.length);
    assertAllClose(riskEstimates, golden.risks, ATOL_DETERMINISTIC);
  });
});
