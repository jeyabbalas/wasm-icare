import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadICARE } from '../../../src/index.node';
import type { ICARE } from '../../../src/index.node';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { icareLit } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { summarizeDistribution } from '../../helpers/summarize';
import { ATOL_DETERMINISTIC, ATOL_DISTRIBUTION, DIST_KEYS } from '../../helpers/tolerances';

/**
 * Mirrors py-icare `tests/test_icare_lit_cross_validation.test_covariate_only`
 * for both age sub-models. No SNP component → deterministic per-subject risks +
 * linear predictors (1e-5); reference distribution via summary stats (5e-3).
 * ge50 exercises the HRT × BMI interaction translation.
 */

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
  reference_risk_summary: Record<string, number>;
}

const SUBMODELS = ['lt50', 'ge50'] as const;

describe('iCARE-Lit compute_absolute_risk (covariate-only)', () => {
  let icare: ICARE;

  beforeAll(async () => {
    icare = await loadICARE();
  });

  afterAll(async () => {
    await icare?.close();
  });

  test.each(SUBMODELS)(
    'sub-model %s: per-subject risks + linear predictors + reference dist match',
    async (submodel) => {
      const golden = loadGolden<CovariateGolden>(`icare_lit_covariate_only_${submodel}.json`);
      const result = await icare.computeAbsoluteRisk({
        applyAgeStart: golden.age_start,
        applyAgeIntervalLength: golden.age_interval_length,
        modelDiseaseIncidenceRates: { path: icareLit('age_specific_breast_cancer_incidence_rates.csv') },
        modelCompetingIncidenceRates: { path: icareLit('age_specific_all_cause_mortality_rates.csv') },
        modelCovariateFormula: { path: icareLit(`model_formula_${submodel}.txt`) },
        modelLogRelativeRisk: { path: icareLit(`model_log_odds_ratios_${submodel}.json`) },
        modelReferenceDataset: { path: icareLit(`reference_covariate_data_${submodel}.csv`) },
        applyCovariateProfile: { path: icareLit(`icare_lit_query_${submodel}.csv`) },
        returnLinearPredictors: true,
        returnReferenceRisks: true,
      });

      const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
      const linearPredictors = result.profile.columns.linear_predictors as Float64Array;
      expect(riskEstimates).toBeInstanceOf(Float64Array);
      assertAllClose(riskEstimates, golden.risks, ATOL_DETERMINISTIC);
      assertAllClose(linearPredictors, golden.linear_predictors, ATOL_DETERMINISTIC);

      const populationRisks = result.referenceRisks?.[0]?.populationRisks;
      expect(populationRisks).toBeInstanceOf(Float64Array);
      expect(populationRisks?.length).toBe(golden.reference_risk_summary.n);
      const summary = summarizeDistribution(populationRisks as Float64Array);
      assertDistributionClose(summary, golden.reference_risk_summary, ATOL_DISTRIBUTION, DIST_KEYS);
    },
  );
});
