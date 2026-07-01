/**
 * BPC3 compute_absolute_risk input-kind parity. The covariate-only case is run
 * with the tabular datasets fed in each supported input form; every form must
 * produce identical risks / linear predictors / reference distribution and match
 * the R-derived golden. Proves the object sink is dtype-faithful and the input
 * dispatch is correct.
 *
 * Forms: `path` (baseline), `url` (file://), `Blob`, and `columnar`. Arrow has
 * its own spec (Phase 4c).
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { TabularInput } from '../../../src/api/types';
import { loadICARE } from '../../../src/index.node';
import type { ICARE } from '../../../src/index.node';
import { assertAllClose, assertDistributionClose } from '../../helpers/assert';
import { columnsToRows, csvToColumns } from '../../helpers/columns';
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

type Form = 'path' | 'url' | 'blob' | 'columnar' | 'rows';

const FORMS: Form[] = ['path', 'url', 'blob', 'columnar', 'rows'];

/** A file-backed BPC3 fixture in a byte/FS form (path / file:// url / Blob). */
function fileInput(name: string, form: Form): { path: string } | { url: URL } | Blob {
  const path = bpc3(name);
  if (form === 'url') return { url: pathToFileURL(path) };
  if (form === 'blob') return new Blob([readFileSync(path)]);
  return { path }; // 'path', and 'columnar' for non-tabular files (formula / log-OR)
}

/** A BPC3 tabular fixture; `columnar`/`rows` use the object sink, else a byte/FS form. */
function tabular(name: string, form: Form): TabularInput {
  if (form === 'columnar') return csvToColumns(bpc3(name));
  if (form === 'rows') return columnsToRows(csvToColumns(bpc3(name)));
  return fileInput(name, form);
}

describe('BPC3 compute_absolute_risk — input-kind parity (covariate-only)', () => {
  let icare: ICARE;
  beforeAll(async () => {
    icare = await loadICARE();
  });
  afterAll(async () => {
    await icare?.close();
  });

  test.each(FORMS)('tabular inputs as %s match the golden', async (form) => {
    const golden = loadGolden<CovariateGolden>('bpc3_covariate_only.json');

    const result = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      modelDiseaseIncidenceRates: tabular('age_specific_breast_cancer_incidence_rates.csv', form),
      modelCompetingIncidenceRates: tabular('age_specific_all_cause_mortality_rates.csv', form),
      modelCovariateFormula: fileInput('breast_cancer_covariate_model_formula.txt', form),
      modelLogRelativeRisk: fileInput('breast_cancer_model_log_odds_ratios.json', form),
      modelReferenceDataset: tabular('reference_covariate_data.csv', form),
      applyCovariateProfile: tabular('query_covariate_profile.csv', form),
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
