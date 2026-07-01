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
      _options: ComputeAbsoluteRiskSplitIntervalOptions,
    ): Promise<AbsoluteRiskResult> {
      throw new ICAREError(
        'computeAbsoluteRiskSplitInterval is not implemented yet (lands in Phase 5).',
      );
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

/** The generic marshalled `compute` result, before camelCase shaping. */
interface RawAbsoluteRiskResult {
  model: Record<string, number>;
  profile: ColumnarTableResult;
  reference_risks?: Array<{
    age_interval_start: number;
    age_interval_end: number;
    population_risks: Float64Array;
  }>;
  method: string;
}

/** Map the generic marshalled tree onto the public camelCase result type. */
function shapeAbsoluteRiskResult(raw: unknown): AbsoluteRiskResult {
  const result = raw as RawAbsoluteRiskResult;
  const result_: AbsoluteRiskResult = {
    model: result.model,
    profile: result.profile,
    method: result.method,
  };
  if (result.reference_risks) {
    result_.referenceRisks = result.reference_risks.map(
      (interval): ReferenceRiskInterval => ({
        ageIntervalStart: interval.age_interval_start,
        ageIntervalEnd: interval.age_interval_end,
        populationRisks: interval.population_risks,
      }),
    );
  }
  return result_;
}
