import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadICARE } from '../../../src/index.node';
import type { AbsoluteRiskResult, ICARE } from '../../../src/index.node';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { summarizeDistribution } from '../../helpers/summarize';
import { ATOL_DISTRIBUTION, ATOL_STOCHASTIC, DIST_KEYS, GOLDEN_SEED } from '../../helpers/tolerances';

/**
 * Mirrors py-icare `tests/test_bpc3_cross_validation` SNP workflows. SNP
 * imputation is stochastic across R/Python RNGs, so per-subject risks are
 * compared loosely (2e-2, seed 50) and the imputed reference-population
 * distribution via stable summary statistics (5e-3, excluding min/max).
 */

interface SnpGolden {
  age_start: number;
  age_interval_length: number;
  risks?: number[];
  reference_risk_summary: Record<string, number>;
}

const INCIDENCE = {
  modelDiseaseIncidenceRates: { path: bpc3('age_specific_breast_cancer_incidence_rates.csv') },
  modelCompetingIncidenceRates: { path: bpc3('age_specific_all_cause_mortality_rates.csv') },
} as const;

function assertReferenceDistribution(result: AbsoluteRiskResult, golden: SnpGolden): void {
  const populationRisks = result.referenceRisks?.[0]?.populationRisks;
  expect(populationRisks).toBeInstanceOf(Float64Array);
  expect(populationRisks?.length).toBe(golden.reference_risk_summary.n);
  const summary = summarizeDistribution(populationRisks as Float64Array);
  assertDistributionClose(summary, golden.reference_risk_summary, ATOL_DISTRIBUTION, DIST_KEYS);
}

describe('BPC3 compute_absolute_risk (SNP workflows)', () => {
  let icare: ICARE;

  beforeAll(async () => {
    icare = await loadICARE();
  });

  afterAll(async () => {
    await icare?.close();
  });

  test('snp-only, no profile: imputed reference distribution matches (stochastic)', async () => {
    const golden = loadGolden<SnpGolden>('bpc3_snp_only_no_profile.json');
    const result = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      ...INCIDENCE,
      modelSnpInfo: { path: bpc3('breast_cancer_72_snps_info.csv') },
      returnReferenceRisks: true,
      seed: GOLDEN_SEED,
    });
    assertReferenceDistribution(result, golden);
  });

  test('snp-only, with profile: per-subject risks + reference dist match (stochastic)', async () => {
    const golden = loadGolden<SnpGolden>('bpc3_snp_only_with_profile.json');
    const result = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      ...INCIDENCE,
      modelSnpInfo: { path: bpc3('breast_cancer_72_snps_info.csv') },
      applySnpProfile: { path: bpc3('query_snp_profile.csv') },
      returnReferenceRisks: true,
      seed: GOLDEN_SEED,
    });
    const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
    assertAllClose(riskEstimates, golden.risks!, ATOL_STOCHASTIC);
    assertReferenceDistribution(result, golden);
  });

  test('combined covariate + SNP (family history): per-subject risks + reference dist match', async () => {
    const golden = loadGolden<SnpGolden>('bpc3_combined.json');
    const result = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      ...INCIDENCE,
      modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
      modelReferenceDataset: { path: bpc3('reference_covariate_data.csv') },
      modelSnpInfo: { path: bpc3('breast_cancer_72_snps_info.csv') },
      modelFamilyHistoryVariableName: 'family_history',
      applyCovariateProfile: { path: bpc3('query_covariate_profile.csv') },
      applySnpProfile: { path: bpc3('query_snp_profile.csv') },
      returnReferenceRisks: true,
      seed: GOLDEN_SEED,
    });
    const riskEstimates = result.profile.columns.risk_estimates as Float64Array;
    assertAllClose(riskEstimates, golden.risks!, ATOL_STOCHASTIC);
    assertReferenceDistribution(result, golden);
  });
});
