import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadICARE } from '../../../src/index.node';
import type { ICARE, SplitModel } from '../../../src/index.node';
import { assertAllClose } from '../../helpers/assert';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { ATOL_DETERMINISTIC, ATOL_STOCHASTIC, GOLDEN_SEED } from '../../helpers/tolerances';

/**
 * Mirrors py-icare `tests/test_bpc3_cross_validation.test_split_interval_*`: a
 * pre/post-cutpoint model split at age 50, combined via
 * `risk = before + (1 - before) * after`. Covariate-only is deterministic (1e-5);
 * the SNP-augmented case is stochastic across R/Python RNGs (2e-2, seed 50).
 */

interface SplitGolden {
  age_start: number;
  age_interval_length: number;
  cutpoint: number;
  risks: number[];
}

const INCIDENCE = {
  modelDiseaseIncidenceRates: { path: bpc3('age_specific_breast_cancer_incidence_rates.csv') },
  modelCompetingIncidenceRates: { path: bpc3('age_specific_all_cause_mortality_rates.csv') },
} as const;

describe('BPC3 compute_absolute_risk_split_interval', () => {
  let icare: ICARE;

  beforeAll(async () => {
    icare = await loadICARE();
  });

  afterAll(async () => {
    await icare?.close();
  });

  test('covariate-only: combined pre/post-cutpoint risks match the golden (deterministic)', async () => {
    const golden = loadGolden<SplitGolden>('bpc3_split_interval_covariate_only.json');

    const result = await icare.computeAbsoluteRiskSplitInterval({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      cutpoint: golden.cutpoint,
      ...INCIDENCE,
      modelCovariateFormulaBeforeCutpoint: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelCovariateFormulaAfterCutpoint: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelLogRelativeRiskBeforeCutpoint: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
      modelLogRelativeRiskAfterCutpoint: { path: bpc3('breast_cancer_model_log_odds_ratios_post_50.json') },
      modelReferenceDatasetBeforeCutpoint: { path: bpc3('reference_covariate_data.csv') },
      modelReferenceDatasetAfterCutpoint: { path: bpc3('reference_covariate_data_post_50.csv') },
      applyCovariateProfileBeforeCutpoint: { path: bpc3('query_covariate_profile.csv') },
      applyCovariateProfileAfterCutpoint: { path: bpc3('query_covariate_profile.csv') },
    });

    const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
    expect(riskEstimates).toBeInstanceOf(Float64Array);
    assertAllClose(riskEstimates, golden.risks, ATOL_DETERMINISTIC);

    // The combiner nests fitted betas per side — proves split-shaping (not the flat compute shape).
    const model = result.model as SplitModel;
    expect(model.beforeCutpoint).toBeTypeOf('object');
    expect(model.afterCutpoint).toBeTypeOf('object');
    expect(Object.keys(model.beforeCutpoint).length).toBeGreaterThan(0);
  });

  test('combined covariate + SNP: split-interval risks match the golden (stochastic, seed 50)', async () => {
    const golden = loadGolden<SplitGolden>('bpc3_split_interval_combined.json');

    const result = await icare.computeAbsoluteRiskSplitInterval({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      cutpoint: golden.cutpoint,
      ...INCIDENCE,
      modelCovariateFormulaBeforeCutpoint: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelCovariateFormulaAfterCutpoint: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelLogRelativeRiskBeforeCutpoint: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
      modelLogRelativeRiskAfterCutpoint: { path: bpc3('breast_cancer_model_log_odds_ratios_post_50.json') },
      modelReferenceDatasetBeforeCutpoint: { path: bpc3('reference_covariate_data.csv') },
      modelReferenceDatasetAfterCutpoint: { path: bpc3('reference_covariate_data_post_50.csv') },
      modelSnpInfo: { path: bpc3('breast_cancer_72_snps_info.csv') },
      modelFamilyHistoryVariableNameBeforeCutpoint: 'family_history',
      modelFamilyHistoryVariableNameAfterCutpoint: 'family_history',
      applyCovariateProfileBeforeCutpoint: { path: bpc3('query_covariate_profile.csv') },
      applyCovariateProfileAfterCutpoint: { path: bpc3('query_covariate_profile.csv') },
      applySnpProfile: { path: bpc3('query_snp_profile.csv') },
      seed: GOLDEN_SEED,
    });

    const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
    expect(riskEstimates).toBeInstanceOf(Float64Array);
    assertAllClose(riskEstimates, golden.risks, ATOL_STOCHASTIC);
  });
});
