/**
 * BPC3 compute_absolute_risk via the opt-in Arrow input path. The reference
 * dataset and covariate profile are fed as `apache-arrow` Tables (crossing to
 * Python as Arrow IPC bytes, rebuilt with pyarrow); the result must match the
 * same R-derived golden as the byte/FS and columnar routes.
 *
 * Requires pyarrow, loaded via `loadICARE({ packages: ['pyarrow'] })`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadICARE } from '../../../src/index.node';
import type { ICARE } from '../../../src/index.node';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { csvToArrowTable } from '../../helpers/arrow';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { summarizeDistribution } from '../../helpers/summarize';
import { ATOL_DETERMINISTIC, ATOL_DISTRIBUTION, DIST_KEYS } from '../../helpers/tolerances';

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
  reference_risk_summary: Record<string, number>;
}

describe('BPC3 compute_absolute_risk — Arrow input (covariate-only)', () => {
  let icare: ICARE;
  beforeAll(async () => {
    icare = await loadICARE({ packages: ['pyarrow'] });
  });
  afterAll(async () => {
    await icare?.close();
  });

  test('reference + profile as Arrow tables match the golden', async () => {
    const golden = loadGolden<CovariateGolden>('bpc3_covariate_only.json');

    const result = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      modelDiseaseIncidenceRates: { path: bpc3('age_specific_breast_cancer_incidence_rates.csv') },
      modelCompetingIncidenceRates: { path: bpc3('age_specific_all_cause_mortality_rates.csv') },
      modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
      modelReferenceDataset: csvToArrowTable(bpc3('reference_covariate_data.csv')),
      applyCovariateProfile: csvToArrowTable(bpc3('query_covariate_profile.csv')),
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
  });
});
