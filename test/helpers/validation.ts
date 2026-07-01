/**
 * Validation-spec helpers mirroring py-icare's `test_*_cross_validation`
 * validation cases: the R-derived golden shape, the metric assertions
 * (`_assert_validation_metrics`), and the in-memory BPC3 study/weights join
 * (`_build_validation_study`).
 */

import { expect } from 'vitest';

import type { ColumnarTable, ValidationResult } from '../../src/api/types';
import { bpc3 } from './fixtures';
import { csvToColumns } from './columns';
import { ATOL_AUC, ATOL_EO, HL_ALPHA } from './tolerances';

/** The flat R-derived validation golden (summary scalars only). */
export interface ValidationGolden {
  auc: number;
  auc_ci: [number, number];
  eo_ratio: number;
  eo_ci: [number, number];
  hl_chisq: number;
  hl_df: number;
  hl_pvalue: number;
  rr_chisq: number;
  rr_df: number;
  rr_pvalue: number;
}

/**
 * Mirror of py-icare's `_assert_validation_metrics`: overall E/O ratio (1e-2) and
 * AUC (1e-3) agree numerically; the Hosmer-Lemeshow chi-square magnitude differs
 * between R and py weighted binning, so only the calibration *conclusion* at
 * `HL_ALPHA` must agree.
 */
export function assertValidationMetrics(result: ValidationResult, golden: ValidationGolden): void {
  expect(Math.abs(result.expectedByObservedRatio.ratio - golden.eo_ratio)).toBeLessThanOrEqual(ATOL_EO);
  expect(Math.abs(result.auc.auc - golden.auc)).toBeLessThanOrEqual(ATOL_AUC);
  const pyP = result.calibration.absoluteRisk.pValue;
  expect(pyP < HL_ALPHA).toBe(golden.hl_pvalue < HL_ALPHA);
}

/**
 * Reproduce py-icare's `_build_validation_study` in memory: the BPC3 nested
 * case-control study with its `sampling_weights` column *overridden* by the
 * R-exported glm inclusion weights (id-keyed). The presence of a
 * `sampling_weights` column selects py-icare's weighted AUC/HL path, and the
 * exact weights make both engines validate identically. Returned as a columnar
 * table (object sink) so no temp file is needed.
 */
export function buildValidationStudy(): ColumnarTable {
  const study = csvToColumns(bpc3('validation_nested_case_control_data.csv'));
  const weights = csvToColumns(bpc3('bpc3_nested_cc_glm_weights.csv'));

  const weightId = weights.columns.id as ArrayLike<number>;
  const weightValue = weights.columns.sampling_weights as ArrayLike<number>;
  const byId = new Map<number, number>();
  for (let i = 0; i < weightId.length; i += 1) {
    byId.set(Number(weightId[i]), Number(weightValue[i]));
  }

  const studyId = study.columns.id as ArrayLike<number>;
  const samplingWeights = new Float64Array(studyId.length);
  for (let i = 0; i < studyId.length; i += 1) {
    samplingWeights[i] = byId.get(Number(studyId[i])) ?? Number.NaN;
  }

  // Override in place (same key) → original column order preserved.
  return { columns: { ...study.columns, sampling_weights: samplingWeights } };
}
