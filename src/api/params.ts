/**
 * Parameter naming — the single source of truth for camelCase (JS) ↔ snake_case
 * (py-icare) mapping, in ONE place.
 *
 * v2 accepts a polymorphic `DataInput` for every dataset argument, so — unlike
 * v1 — the JS option keys drop the `...Url` suffix (e.g. `modelDiseaseIncidenceRates`).
 * The Python side keeps py-icare's `*_path` parameter names, so file-backed
 * arguments gain a `_path` suffix on the Python side; everything else is a plain
 * camelCase→snake_case transform.
 *
 * This layer maps NAMES only. Value marshalling (JS → Python objects, omitted →
 * pyicare default) happens in the bridge (`toPy`) in Phase 2. Crucially,
 * `toPythonKwargs` OMITS absent keys so pyicare applies its own defaults — this
 * is the fix for the v1 `seed = 1234` divergence (py-icare's default is `None`).
 */

export type ParamKind = 'value' | 'data' | 'formula' | 'logOR' | 'snpInfo' | 'nested';

export type Operation = 'compute' | 'splitInterval' | 'validate';

/** Kinds whose Python parameter carries a `_path` suffix (file-backed args). */
const PATH_KINDS: ReadonlySet<ParamKind> = new Set<ParamKind>([
  'data',
  'formula',
  'logOR',
  'snpInfo',
]);

/**
 * camelCase → snake_case. Our parameter names contain no digits or acronym
 * runs, so the simple per-capital transform is exact (verified by the drift
 * guard in test/unit/params.test.ts against py-icare's real signatures).
 */
export function camelToSnake(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/** Derive the py-icare parameter name for a JS option key of a given kind. */
export function toPythonName(js: string, kind: ParamKind): string {
  const snake = camelToSnake(js);
  return PATH_KINDS.has(kind) ? `${snake}_path` : snake;
}

interface RawSpec {
  js: string;
  kind: ParamKind;
}

export interface ParamSpec {
  /** camelCase option key exposed to SDK callers. */
  js: string;
  /** snake_case keyword argument passed to py-icare. */
  py: string;
  /** Logical role — drives the `_path` suffix and (later) input dispatch. */
  kind: ParamKind;
}

function resolve(raw: readonly RawSpec[]): ParamSpec[] {
  return raw.map((r) => ({ js: r.js, py: toPythonName(r.js, r.kind), kind: r.kind }));
}

// --- compute_absolute_risk (16) ---------------------------------------------

const COMPUTE_RAW: readonly RawSpec[] = [
  { js: 'applyAgeStart', kind: 'value' },
  { js: 'applyAgeIntervalLength', kind: 'value' },
  { js: 'modelDiseaseIncidenceRates', kind: 'data' },
  { js: 'modelCompetingIncidenceRates', kind: 'data' },
  { js: 'modelCovariateFormula', kind: 'formula' },
  { js: 'modelLogRelativeRisk', kind: 'logOR' },
  { js: 'modelReferenceDataset', kind: 'data' },
  { js: 'modelReferenceDatasetWeightsVariableName', kind: 'value' },
  { js: 'modelSnpInfo', kind: 'snpInfo' },
  { js: 'modelFamilyHistoryVariableName', kind: 'value' },
  { js: 'numImputations', kind: 'value' },
  { js: 'applyCovariateProfile', kind: 'data' },
  { js: 'applySnpProfile', kind: 'data' },
  { js: 'returnLinearPredictors', kind: 'value' },
  { js: 'returnReferenceRisks', kind: 'value' },
  { js: 'seed', kind: 'value' },
];

export const COMPUTE_ABSOLUTE_RISK_PARAMS: ParamSpec[] = resolve(COMPUTE_RAW);

// --- compute_absolute_risk_split_interval (23) ------------------------------

const SPLIT_INTERVAL_RAW: readonly RawSpec[] = [
  { js: 'applyAgeStart', kind: 'value' },
  { js: 'applyAgeIntervalLength', kind: 'value' },
  { js: 'modelDiseaseIncidenceRates', kind: 'data' },
  { js: 'modelCompetingIncidenceRates', kind: 'data' },
  { js: 'modelCovariateFormulaBeforeCutpoint', kind: 'formula' },
  { js: 'modelCovariateFormulaAfterCutpoint', kind: 'formula' },
  { js: 'modelLogRelativeRiskBeforeCutpoint', kind: 'logOR' },
  { js: 'modelLogRelativeRiskAfterCutpoint', kind: 'logOR' },
  { js: 'modelReferenceDatasetBeforeCutpoint', kind: 'data' },
  { js: 'modelReferenceDatasetAfterCutpoint', kind: 'data' },
  { js: 'modelReferenceDatasetWeightsVariableNameBeforeCutpoint', kind: 'value' },
  { js: 'modelReferenceDatasetWeightsVariableNameAfterCutpoint', kind: 'value' },
  { js: 'modelSnpInfo', kind: 'snpInfo' },
  { js: 'modelFamilyHistoryVariableNameBeforeCutpoint', kind: 'value' },
  { js: 'modelFamilyHistoryVariableNameAfterCutpoint', kind: 'value' },
  { js: 'applyCovariateProfileBeforeCutpoint', kind: 'data' },
  { js: 'applyCovariateProfileAfterCutpoint', kind: 'data' },
  { js: 'applySnpProfile', kind: 'data' },
  { js: 'cutpoint', kind: 'value' },
  { js: 'numImputations', kind: 'value' },
  { js: 'returnLinearPredictors', kind: 'value' },
  { js: 'returnReferenceRisks', kind: 'value' },
  { js: 'seed', kind: 'value' },
];

export const COMPUTE_ABSOLUTE_RISK_SPLIT_INTERVAL_PARAMS: ParamSpec[] =
  resolve(SPLIT_INTERVAL_RAW);

// --- validate_absolute_risk_model (14) --------------------------------------

const VALIDATE_RAW: readonly RawSpec[] = [
  { js: 'studyData', kind: 'data' },
  { js: 'predictedRiskInterval', kind: 'value' },
  { js: 'icareModelParameters', kind: 'nested' },
  { js: 'predictedRiskVariableName', kind: 'value' },
  { js: 'linearPredictorVariableName', kind: 'value' },
  { js: 'referenceEntryAge', kind: 'value' },
  { js: 'referenceExitAge', kind: 'value' },
  { js: 'referencePredictedRisks', kind: 'value' },
  { js: 'referenceLinearPredictors', kind: 'value' },
  { js: 'numberOfPercentiles', kind: 'value' },
  { js: 'linearPredictorCutoffs', kind: 'value' },
  { js: 'datasetName', kind: 'value' },
  { js: 'modelName', kind: 'value' },
  { js: 'seed', kind: 'value' },
];

export const VALIDATE_ABSOLUTE_RISK_MODEL_PARAMS: ParamSpec[] = resolve(VALIDATE_RAW);

// --- Registry + mapping functions -------------------------------------------

export const PARAM_TABLES: Record<Operation, ParamSpec[]> = {
  compute: COMPUTE_ABSOLUTE_RISK_PARAMS,
  splitInterval: COMPUTE_ABSOLUTE_RISK_SPLIT_INTERVAL_PARAMS,
  validate: VALIDATE_ABSOLUTE_RISK_MODEL_PARAMS,
};

/** The ordered parameter specs for an operation. */
export function paramSpecs(op: Operation): ParamSpec[] {
  return PARAM_TABLES[op];
}

/** The ordered py-icare (snake_case) parameter names for an operation. */
export function pythonNames(op: Operation): string[] {
  return PARAM_TABLES[op].map((s) => s.py);
}

/** The ordered JS (camelCase) option keys for an operation. */
export function jsNames(op: Operation): string[] {
  return PARAM_TABLES[op].map((s) => s.js);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rename a camelCase options object to py-icare snake_case kwargs.
 *
 * - Keys with `undefined` values are OMITTED, so py-icare applies its own
 *   defaults (no spurious `seed`, `numImputations`, etc.).
 * - The `nested` kind (`icareModelParameters`) recurses through the
 *   `compute_absolute_risk` map; an explicit `null` (→ Python `None`) passes
 *   through untouched.
 * - Unknown keys are ignored (the typed options interfaces constrain callers).
 */
export function toPythonKwargs(
  op: Operation,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of PARAM_TABLES[op]) {
    const value = options[spec.js];
    if (value === undefined) continue;
    if (spec.kind === 'nested') {
      out[spec.py] = isPlainObject(value) ? toPythonKwargs('compute', value) : value;
    } else {
      out[spec.py] = value;
    }
  }
  return out;
}

/**
 * Inverse of {@link toPythonKwargs} (snake_case kwargs → camelCase options).
 * Primarily used to prove the mapping is a lossless bijection.
 */
export function fromPythonKwargs(
  op: Operation,
  kwargs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of PARAM_TABLES[op]) {
    const value = kwargs[spec.py];
    if (value === undefined) continue;
    if (spec.kind === 'nested') {
      out[spec.js] = isPlainObject(value) ? fromPythonKwargs('compute', value) : value;
    } else {
      out[spec.js] = value;
    }
  }
  return out;
}
