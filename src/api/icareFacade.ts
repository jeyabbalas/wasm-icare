/**
 * The public ICARE handle — a thin, env-neutral veneer over an {@link Engine}.
 *
 * `createICARE` wires the name-mapping (`params.ts`), input resolution (an
 * injected env-specific materializer), the low-level engine dispatch, and output
 * shaping into the three public methods. Phase 3 implements `computeAbsoluteRisk`
 * (via `{ path }` inputs); split-interval and validation land in Phase 5.
 */

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

/**
 * Resolves a data-bearing option value into what py-icare expects — an FS path
 * (byte/FS sink) or an inline value. Env-specific (Node reads host files; the
 * browser fetches/reads Blobs, Phase 4). Returns the resolved value.
 */
export type InputMaterializer = (
  input: unknown,
  kind: ParamKind,
  jsName: string,
) => Promise<unknown>;

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
      const resolved = await resolveInputs('compute', options, materialize);
      const kwargs = toPythonKwargs('compute', resolved);
      return shapeAbsoluteRiskResult(engine.run('compute', kwargs));
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

/**
 * Resolve every data-bearing option to an FS path / inline value, leaving scalar
 * params untouched. Returns a fresh options object suitable for `toPythonKwargs`.
 */
async function resolveInputs(
  op: Operation,
  options: object,
  materialize: InputMaterializer,
): Promise<Record<string, unknown>> {
  const source = options as Record<string, unknown>;
  const resolved: Record<string, unknown> = { ...source };
  for (const spec of paramSpecs(op)) {
    if (!DATA_KINDS.has(spec.kind)) continue;
    const value = source[spec.js];
    if (value === undefined) continue;
    resolved[spec.js] = await materialize(value, spec.kind, spec.js);
  }
  return resolved;
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
