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
import { paramSpecs, toPythonKwargs, type Operation, type ParamKind } from './params';
import type {
  AbsoluteRiskResult,
  ColumnarTableResult,
  ComputeAbsoluteRiskOptions,
  ComputeAbsoluteRiskSplitIntervalOptions,
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
      _options: ValidateAbsoluteRiskModelOptions,
    ): Promise<ValidationResult> {
      throw new ICAREError(
        'validateAbsoluteRiskModel is not implemented yet (lands in Phase 5).',
      );
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
async function resolveInputs(
  op: Operation,
  options: object,
  materialize: InputMaterializer,
): Promise<ResolvedCall> {
  const source = options as Record<string, unknown>;
  const resolved: Record<string, unknown> = { ...source };
  const frames: Record<string, FrameInput> = {};
  for (const spec of paramSpecs(op)) {
    if (!DATA_KINDS.has(spec.kind)) continue;
    const value = source[spec.js];
    if (value === undefined) continue;
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
function shapeAbsoluteRiskResult(raw: unknown): AbsoluteRiskResult {
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
