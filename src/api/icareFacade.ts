/**
 * The public ICARE handle — a thin, env-neutral veneer over an {@link Engine}.
 *
 * `createICARE` wires the name-mapping (`params.ts`), input resolution (an
 * injected env-specific materializer), the low-level engine dispatch, and output
 * shaping into the three public methods. Phase 3 implements `computeAbsoluteRisk`
 * (via `{ path }` inputs); split-interval and validation land in Phase 5.
 */

import type { FramePayload } from '../io/columnar';
import type { Engine } from '../runtime/engine';
import { ICAREError } from '../util/errors';
import { createModelHandle } from './buildAbsoluteRiskModel';
import { paramSpecs, toPythonKwargs, type Operation, type ParamKind } from './params';
import type {
  AbsoluteRiskModelHandle,
  AbsoluteRiskResult,
  BuildAbsoluteRiskModelOptions,
  ColumnarTableResult,
  ComputeAbsoluteRiskOptions,
  ComputeAbsoluteRiskSplitIntervalOptions,
  GoodnessOfFitTest,
  ICARE,
  ReferenceRiskInterval,
  SplitIntervalResult,
  ValidateAbsoluteRiskModelOptions,
  ValidationResult,
} from './types';

/** An object-sink frame: a dtype-tagged columnar table or Arrow IPC bytes. */
export type FrameInput = FramePayload | { arrow_ipc: Uint8Array };

/**
 * What a materializer resolves a data-bearing option to — either a scalar
 * `kwarg` value merged into the py-icare kwargs (an FS path from the byte/FS
 * sink, or an inline formula/log-OR), or a `frame` passed via the object-sink
 * channel (keyed by the py-icare parameter name).
 */
export type MaterializedInput =
  | { via: 'kwarg'; value: unknown }
  | { via: 'frame'; frame: FrameInput };

/**
 * Resolves a data-bearing option value into what py-icare expects. Env-specific
 * (Node reads host files / URLs / Blobs; the browser materializer lands in
 * Phase 7).
 */
export type InputMaterializer = (
  input: unknown,
  kind: ParamKind,
  jsName: string,
) => Promise<MaterializedInput>;

/** Kinds whose value is a data source that must be resolved before dispatch. */
const DATA_KINDS: ReadonlySet<ParamKind> = new Set<ParamKind>([
  'data',
  'formula',
  'logOR',
  'snpInfo',
]);

/** Build the public handle over a ready engine + an input materializer. */
export function createICARE(engine: Engine, materialize: InputMaterializer): ICARE {
  return {
    async computeAbsoluteRisk(
      options: ComputeAbsoluteRiskOptions,
    ): Promise<AbsoluteRiskResult> {
      const { kwargs, frames } = await resolveInputs('compute', options, materialize);
      return shapeAbsoluteRiskResult(engine.run('compute', kwargs, frames));
    },

    async computeAbsoluteRiskSplitInterval(
      options: ComputeAbsoluteRiskSplitIntervalOptions,
    ): Promise<SplitIntervalResult> {
      const { kwargs, frames } = await resolveInputs('splitInterval', options, materialize);
      return shapeSplitIntervalResult(engine.run('splitInterval', kwargs, frames));
    },

    async validateAbsoluteRiskModel(
      options: ValidateAbsoluteRiskModelOptions,
    ): Promise<ValidationResult> {
      const { kwargs, frames } = await resolveInputs('validate', options, materialize);
      return shapeValidationResult(engine.run('validate', kwargs, frames));
    },

    async buildAbsoluteRiskModel(
      options: BuildAbsoluteRiskModelOptions,
    ): Promise<AbsoluteRiskModelHandle> {
      const { kwargs, frames } = await resolveInputs('buildModel', options, materialize);
      const { handle, model } = engine.buildModel(kwargs, frames);
      return createModelHandle(engine, materialize, handle, model);
    },

    async close(): Promise<void> {
      await engine.close();
    },
  };
}

/** A resolved operation call: snake_case kwargs plus an optional object-sink map. */
interface ResolvedCall {
  kwargs: Record<string, unknown>;
  frames: Record<string, FrameInput> | null;
}

/**
 * Resolve every data-bearing option to a kwarg (FS path / inline value) or an
 * object-sink `frame`, leaving scalar params untouched. `frame` inputs are
 * routed to `frames` keyed by the py-icare parameter name and dropped from the
 * kwargs (so a given input goes to EITHER kwargs OR frames, never both).
 */
export async function resolveInputs(
  op: Operation,
  options: object,
  materialize: InputMaterializer,
): Promise<ResolvedCall> {
  const source = options as Record<string, unknown>;
  const resolved: Record<string, unknown> = { ...source };
  const frames: Record<string, FrameInput> = {};
  for (const spec of paramSpecs(op)) {
    const value = source[spec.js];
    if (value === undefined) continue;
    if (spec.kind === 'nested') {
      // `icareModelParameters`: materialize its inner data inputs in place, then
      // let toPythonKwargs rename the (still camelCase) nested map exactly once.
      if (isPlainObject(value)) {
        resolved[spec.js] = await resolveNested(value, materialize);
      }
      continue;
    }
    if (!DATA_KINDS.has(spec.kind)) continue;
    const materialized = await materialize(value, spec.kind, spec.js);
    if (materialized.via === 'frame') {
      frames[spec.py] = materialized.frame;
      delete resolved[spec.js];
    } else {
      resolved[spec.js] = materialized.value;
    }
  }
  return {
    kwargs: toPythonKwargs(op, resolved),
    frames: Object.keys(frames).length > 0 ? frames : null,
  };
}

/**
 * Resolve the `compute`-shaped data inputs nested inside `icareModelParameters`,
 * keeping their camelCase keys (so the outer `toPythonKwargs` renames them once).
 *
 * The object-sink frame channel merges at the top level only, so an in-memory
 * table (columnar / rows / Arrow) *inside* `icareModelParameters` is unsupported
 * and throws; every nested input must be a `{ path }` / `{ url }` / `Blob` or an
 * inline formula / log-OR. This covers both validation cross-validation suites.
 */
async function resolveNested(
  nested: Record<string, unknown>,
  materialize: InputMaterializer,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...nested };
  for (const spec of paramSpecs('compute')) {
    if (!DATA_KINDS.has(spec.kind)) continue;
    const value = nested[spec.js];
    if (value === undefined) continue;
    const materialized = await materialize(value, spec.kind, spec.js);
    if (materialized.via === 'frame') {
      throw new ICAREError(
        `'${spec.js}' inside icareModelParameters must be a { path } / { url } / Blob ` +
          'or an inline formula / log-OR; in-memory tables there are not supported yet.',
      );
    }
    out[spec.js] = materialized.value;
  }
  return out;
}

/** One `reference_risks` interval as the bridge marshals it (snake_case). */
interface RawReferenceRiskInterval {
  age_interval_start: number;
  age_interval_end: number;
  population_risks: Float64Array;
}

/** Map a marshalled `reference_risks` array onto camelCase intervals. */
function toReferenceRiskIntervals(raw: RawReferenceRiskInterval[]): ReferenceRiskInterval[] {
  return raw.map((interval) => ({
    ageIntervalStart: interval.age_interval_start,
    ageIntervalEnd: interval.age_interval_end,
    populationRisks: interval.population_risks,
  }));
}

/** A non-null, non-array object (discriminates nested vs flat result/param shapes). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The generic marshalled `compute` result, before camelCase shaping. */
interface RawAbsoluteRiskResult {
  model: Record<string, number>;
  profile: ColumnarTableResult;
  reference_risks?: RawReferenceRiskInterval[];
  method: string;
}

/** Map the generic marshalled tree onto the public camelCase result type. */
export function shapeAbsoluteRiskResult(raw: unknown): AbsoluteRiskResult {
  const result = raw as RawAbsoluteRiskResult;
  const shaped: AbsoluteRiskResult = {
    model: result.model,
    profile: result.profile,
    method: result.method,
  };
  if (result.reference_risks) {
    shaped.referenceRisks = toReferenceRiskIntervals(result.reference_risks);
  }
  return shaped;
}

/** The generic marshalled split-interval result, before camelCase shaping. */
interface RawSplitIntervalResult {
  model: Record<string, unknown>;
  profile: ColumnarTableResult;
  reference_risks?:
    | RawReferenceRiskInterval[]
    | {
        before_cutpoint: RawReferenceRiskInterval[];
        after_cutpoint: RawReferenceRiskInterval[];
      };
  method: string;
}

/**
 * Shape a split-interval result. `combine_split_absolute_risk_results` nests
 * `model` and `reference_risks` by side (`before_cutpoint` / `after_cutpoint`); a
 * call with no cutpoint params *degrades* to a flat `compute` shape, which we
 * detect (flat `model` betas are numbers, not objects; `reference_risks` an array)
 * and pass through unchanged.
 */
function shapeSplitIntervalResult(raw: unknown): SplitIntervalResult {
  const result = raw as RawSplitIntervalResult;
  const model = result.model;
  const nestedModel =
    isPlainObject(model.before_cutpoint) && isPlainObject(model.after_cutpoint);
  const shaped: SplitIntervalResult = {
    model: nestedModel
      ? {
          beforeCutpoint: model.before_cutpoint as Record<string, number>,
          afterCutpoint: model.after_cutpoint as Record<string, number>,
        }
      : (model as Record<string, number>),
    profile: result.profile,
    method: result.method,
  };
  const refRisks = result.reference_risks;
  if (refRisks !== undefined) {
    shaped.referenceRisks = Array.isArray(refRisks)
      ? toReferenceRiskIntervals(refRisks)
      : {
          beforeCutpoint: toReferenceRiskIntervals(refRisks.before_cutpoint),
          afterCutpoint: toReferenceRiskIntervals(refRisks.after_cutpoint),
        };
  }
  return shaped;
}

/** A goodness-of-fit test node as the bridge marshals it (snake_case). */
interface RawGoodnessOfFit {
  method: string;
  p_value: number;
  variance: number[][];
  statistic: { chi_square: number };
  parameter: { degrees_of_freedom: number };
}

/** The generic marshalled validation result, before camelCase shaping. */
interface RawValidationResult {
  info: { risk_prediction_interval: string; dataset_name: string; model_name: string };
  study_data: ColumnarTableResult;
  incidence_rates: ColumnarTableResult;
  category_specific_calibration: ColumnarTableResult;
  auc: { auc: number; variance: number; lower_ci: number; upper_ci: number };
  brier_score: { brier_score: number; variance: number; lower_ci: number; upper_ci: number };
  expected_by_observed_ratio: { ratio: number; lower_ci: number; upper_ci: number };
  calibration: { absolute_risk: RawGoodnessOfFit; relative_risk: RawGoodnessOfFit };
  reference?: { absolute_risk: number[]; risk_score: number[] };
  method: string;
}

function shapeGoodnessOfFit(g: RawGoodnessOfFit): GoodnessOfFitTest {
  return {
    method: g.method,
    pValue: g.p_value,
    variance: g.variance,
    statistic: { chiSquare: g.statistic.chi_square },
    parameter: { degreesOfFreedom: g.parameter.degrees_of_freedom },
  };
}

/**
 * Shape a validation result onto the public camelCase surface. Only the known
 * scalar/CI metric containers and the frame *keys* are renamed; each frame's
 * `columns` / `order` / `nRows` and the `info` values pass through verbatim — a
 * blanket recursive rename would corrupt DataFrame column names like
 * `observed_absolute_risk` / `linear_predictors_category`.
 */
function shapeValidationResult(raw: unknown): ValidationResult {
  const r = raw as RawValidationResult;
  const shaped: ValidationResult = {
    info: {
      riskPredictionInterval: r.info.risk_prediction_interval,
      datasetName: r.info.dataset_name,
      modelName: r.info.model_name,
    },
    auc: {
      auc: r.auc.auc,
      variance: r.auc.variance,
      lowerCi: r.auc.lower_ci,
      upperCi: r.auc.upper_ci,
    },
    brierScore: {
      brierScore: r.brier_score.brier_score,
      variance: r.brier_score.variance,
      lowerCi: r.brier_score.lower_ci,
      upperCi: r.brier_score.upper_ci,
    },
    expectedByObservedRatio: {
      ratio: r.expected_by_observed_ratio.ratio,
      lowerCi: r.expected_by_observed_ratio.lower_ci,
      upperCi: r.expected_by_observed_ratio.upper_ci,
    },
    calibration: {
      absoluteRisk: shapeGoodnessOfFit(r.calibration.absolute_risk),
      relativeRisk: shapeGoodnessOfFit(r.calibration.relative_risk),
    },
    categorySpecificCalibration: r.category_specific_calibration,
    studyData: r.study_data,
    incidenceRates: r.incidence_rates,
    method: r.method,
  };
  if (r.reference !== undefined) {
    shaped.reference = {
      absoluteRisk: r.reference.absolute_risk,
      riskScore: r.reference.risk_score,
    };
  }
  return shaped;
}
