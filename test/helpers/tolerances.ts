/**
 * Test tolerances + constants, ported verbatim from py-icare's
 * `tests/icare_test_utils.py`. A green E2E asserts against the SAME bounds as
 * py-icare's own cross-validation suite, so the JS↔WASM path and the golden
 * comparison share one source of truth.
 */

export const GOLDEN_SEED = 50;

export const ATOL_DETERMINISTIC = 1e-5; // deterministic per-subject risks / linear predictors
export const ATOL_DISTRIBUTION = 5e-3; // population summary stats (stable across RNGs)
export const ATOL_STOCHASTIC = 2e-2; // per-subject risks depending on SNP imputation
export const ATOL_EO = 1e-2; // expected/observed ratio
export const ATOL_AUC = 1e-3; // AUC (0.5-tie Mann-Whitney credit)
export const HL_ALPHA = 0.05; // Hosmer-Lemeshow calibration conclusion agreement

/** Summary keys compared for reference distributions (min/max are RNG-sensitive). */
export const DIST_KEYS = ['q1', 'median', 'mean', 'q3'] as const;
