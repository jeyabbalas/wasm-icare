/**
 * The fit-once model handle — a thin veneer over a resident Python model built by
 * `bridge.build_model` (the reference dataset was read, and the baseline hazard fitted, once).
 *
 * - `apply` scores one covariate profile batch and returns the full {@link AbsoluteRiskResult}.
 * - `applyBatches` streams many batches, yielding a lean numeric result per batch so peak heap stays
 *   ≈ one batch (the 1M-row lever). The loop is authored `async` / `AsyncIterable` even though the
 *   in-process engine is synchronous, so the Phase 7 worker boundary needs no signature change.
 * - `free` releases the resident Python model.
 */

import type { EngineClient } from '../worker/transport';
import { resolveInputs, shapeAbsoluteRiskResult, type InputMaterializer } from './icareFacade';
import type {
  AbsoluteRiskModelHandle,
  AbsoluteRiskResult,
  ApplyBatchesOptions,
  ApplyBatchResult,
  ApplyProfileOptions,
  ColumnarTable,
  ProfileBatchSource,
} from './types';

/** Build the public {@link AbsoluteRiskModelHandle} over a resident model handle + its fitted betas. */
export function createModelHandle(
  client: EngineClient,
  materialize: InputMaterializer,
  handle: number,
  model: Record<string, number>,
): AbsoluteRiskModelHandle {
  let freed = false;
  const assertLive = (): void => {
    if (freed) throw new Error('absolute-risk model handle has been freed');
  };

  async function apply(options: ApplyProfileOptions): Promise<AbsoluteRiskResult> {
    assertLive();
    const { kwargs, frames } = await resolveInputs('applyModel', options, materialize);
    return shapeAbsoluteRiskResult(await client.applyModel(handle, kwargs, frames));
  }

  async function* applyBatches(
    source: ProfileBatchSource,
    options: ApplyBatchesOptions,
  ): AsyncIterable<ApplyBatchResult> {
    assertLive();
    const {
      applyAgeStart,
      applyAgeIntervalLength,
      batchRows = 100_000,
      returnLinearPredictors,
    } = options;
    for await (const batch of toBatchIterable(source, batchRows)) {
      assertLive();
      const { kwargs, frames } = await resolveInputs(
        'applyModel',
        { applyAgeStart, applyAgeIntervalLength, applyCovariateProfile: batch, returnLinearPredictors },
        materialize,
      );
      const result = shapeAbsoluteRiskResult(await client.applyModel(handle, kwargs, frames));
      yield toApplyBatchResult(result, returnLinearPredictors === true);
    }
  }

  return {
    model,
    apply,
    applyBatches,
    free: async () => {
      if (freed) return;
      freed = true;
      await client.freeModel(handle);
    },
  };
}

/** Normalize the profile source into an async iterable of columnar batches. */
async function* toBatchIterable(
  source: ProfileBatchSource,
  batchRows: number,
): AsyncIterable<ColumnarTable> {
  if (isColumnarTable(source)) {
    yield* sliceColumnarTable(source, batchRows);
    return;
  }
  // Already-batched: an (async) iterable of ColumnarTable supplied by the caller. `for await` accepts
  // sync iterables too, so this covers both Iterable and AsyncIterable sources.
  for await (const batch of source) {
    yield batch;
  }
}

function isColumnarTable(source: ProfileBatchSource): source is ColumnarTable {
  return typeof source === 'object' && source !== null && 'columns' in source;
}

/**
 * Slice a single columnar table into ≤ batchRows-row chunks (typed arrays as subarray VIEWS; no copy).
 * Invariant: a view shares the caller's parent buffer, so batch frames must never be listed as a
 * `postMessage` transferable on the worker path — transferring one would detach every other batch.
 * The RPC transport copies frames in (structured clone) for exactly this reason.
 */
function* sliceColumnarTable(table: ColumnarTable, batchRows: number): Iterable<ColumnarTable> {
  if (!Number.isInteger(batchRows) || batchRows <= 0) {
    throw new Error(`batchRows must be a positive integer, got ${batchRows}`);
  }
  const names = Object.keys(table.columns);
  const total = names.length > 0 ? table.columns[names[0]!]!.length : 0;
  for (let start = 0; start < total; start += batchRows) {
    const end = Math.min(start + batchRows, total);
    const columns: ColumnarTable['columns'] = {};
    for (const name of names) {
      columns[name] = sliceColumn(table.columns[name]!, start, end);
    }
    yield { columns };
  }
}

function sliceColumn(
  col: ColumnarTable['columns'][string],
  start: number,
  end: number,
): ColumnarTable['columns'][string] {
  if (col instanceof Float64Array || col instanceof Int32Array) return col.subarray(start, end);
  return (col as Array<string | number>).slice(start, end) as string[] | number[];
}

/** Extract the lean numeric result from a full apply result, dropping the echoed covariate columns. */
function toApplyBatchResult(
  result: AbsoluteRiskResult,
  withLinearPredictors: boolean,
): ApplyBatchResult {
  const cols = result.profile.columns;
  const out: ApplyBatchResult = {
    riskEstimates: cols.risk_estimates as Float64Array,
    nRows: result.profile.nRows,
  };
  if (withLinearPredictors && cols.linear_predictors instanceof Float64Array) {
    out.linearPredictors = cols.linear_predictors;
  }
  const id = cols.id;
  if (Array.isArray(id)) out.ids = id as string[] | number[];
  return out;
}
