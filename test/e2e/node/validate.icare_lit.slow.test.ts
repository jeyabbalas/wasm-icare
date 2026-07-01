import { afterAll, beforeAll, describe, test } from 'vitest';

import { loadICARE } from '../../../src/index.node';
import type { ICARE } from '../../../src/index.node';
import { icareLit } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { GOLDEN_SEED } from '../../helpers/tolerances';
import { assertValidationMetrics, type ValidationGolden } from '../../helpers/validation';

/**
 * Mirrors py-icare `tests/test_icare_lit_cross_validation.test_validation` (slow):
 * the full-cohort, *unweighted* validation path (the study CSV has no
 * `sampling_weights` column) with the ge50 sub-model. Fed as a `{ path }` study —
 * no in-memory join — with the model inputs nested under `icareModelParameters`.
 */

describe('iCARE-Lit validate_absolute_risk_model (full cohort, unweighted)', () => {
  let icare: ICARE;

  beforeAll(async () => {
    icare = await loadICARE();
  });

  afterAll(async () => {
    await icare?.close();
  });

  test('ge50 model: E/O, AUC, and HL calibration conclusion match the golden', async () => {
    const golden = loadGolden<ValidationGolden>('icare_lit_validation.json');

    const result = await icare.validateAbsoluteRiskModel({
      studyData: { path: icareLit('icare_lit_validation_study.csv') },
      predictedRiskInterval: 'total-followup',
      icareModelParameters: {
        modelDiseaseIncidenceRates: { path: icareLit('age_specific_breast_cancer_incidence_rates.csv') },
        modelCompetingIncidenceRates: { path: icareLit('age_specific_all_cause_mortality_rates.csv') },
        modelCovariateFormula: { path: icareLit('model_formula_ge50.txt') },
        modelLogRelativeRisk: { path: icareLit('model_log_odds_ratios_ge50.json') },
        modelReferenceDataset: { path: icareLit('reference_covariate_data_ge50.csv') },
        applyCovariateProfile: { path: icareLit('icare_lit_validation_covariates.csv') },
      },
      numberOfPercentiles: 10,
      seed: GOLDEN_SEED,
    });

    assertValidationMetrics(result, golden);
  });
});
