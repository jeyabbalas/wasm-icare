import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadICARE } from '../../../src/index.node';
import type { CategoricalColumn, ICARE } from '../../../src/index.node';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { GOLDEN_SEED } from '../../helpers/tolerances';
import {
  assertValidationMetrics,
  buildValidationStudy,
  type ValidationGolden,
} from '../../helpers/validation';

/**
 * Mirrors py-icare `tests/test_bpc3_cross_validation` validation cases (slow):
 * nested case-control, weighted AUC/HL via the R-exported glm sampling weights.
 * The study is fed as an in-memory columnar table (weights overridden in place);
 * the model inputs nest under `icareModelParameters` as `{ path }` fixtures,
 * exercising nested-parameter materialization.
 */

const INCIDENCE = {
  modelDiseaseIncidenceRates: { path: bpc3('age_specific_breast_cancer_incidence_rates.csv') },
  modelCompetingIncidenceRates: { path: bpc3('age_specific_all_cause_mortality_rates.csv') },
} as const;

describe('BPC3 validate_absolute_risk_model (nested case-control, weighted)', () => {
  let icare: ICARE;

  beforeAll(async () => {
    icare = await loadICARE();
  });

  afterAll(async () => {
    await icare?.close();
  });

  test('covariate-only: E/O, AUC, and HL calibration conclusion match the golden', async () => {
    const golden = loadGolden<ValidationGolden>('bpc3_validation_covariate_only.json');

    const result = await icare.validateAbsoluteRiskModel({
      studyData: buildValidationStudy(),
      predictedRiskInterval: 'total-followup',
      icareModelParameters: {
        ...INCIDENCE,
        modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
        modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
        modelReferenceDataset: { path: bpc3('reference_covariate_data.csv') },
        modelFamilyHistoryVariableName: 'family_history',
        applyCovariateProfile: { path: bpc3('validation_nested_case_control_covariate_data.csv') },
      },
      numberOfPercentiles: 10,
      seed: GOLDEN_SEED,
    });

    assertValidationMetrics(result, golden);

    // The linear-predictor bins cross the bridge as a categorical (codes + labels),
    // proving the categorical marshalling path end-to-end.
    const category = result.studyData.columns.linear_predictors_category as CategoricalColumn;
    expect(category.codes).toBeInstanceOf(Int32Array);
    expect(category.codes.length).toBe(result.studyData.nRows);
    expect(category.categories.length).toBeGreaterThan(0);
  });

  test('combined covariate + SNP: E/O, AUC, and HL calibration conclusion match the golden', async () => {
    const golden = loadGolden<ValidationGolden>('bpc3_validation_combined.json');

    const result = await icare.validateAbsoluteRiskModel({
      studyData: buildValidationStudy(),
      predictedRiskInterval: 'total-followup',
      icareModelParameters: {
        ...INCIDENCE,
        modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
        modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
        modelReferenceDataset: { path: bpc3('reference_covariate_data.csv') },
        modelSnpInfo: { path: bpc3('breast_cancer_72_snps_info.csv') },
        modelFamilyHistoryVariableName: 'family_history',
        applyCovariateProfile: { path: bpc3('validation_nested_case_control_covariate_data.csv') },
        applySnpProfile: { path: bpc3('validation_nested_case_control_snp_data.csv') },
      },
      numberOfPercentiles: 10,
      seed: GOLDEN_SEED,
    });

    assertValidationMetrics(result, golden);
  });
});
