/**
 * In-memory columnar object sink — turn a {@link ColumnarTable} (or a row-array)
 * into a dtype-tagged `FramePayload` that the bridge's `build_df` rebuilds into a
 * pandas DataFrame, which py-icare 1.2.0 accepts on any `*_path` argument.
 *
 * Correctness rests on ONE contract: reproduce pandas `read_csv` column-dtype
 * inference —
 *   - all values integer, no missing        -> int64  (`i8`)
 *   - any fractional value OR any missing    -> float64 (`f8`, missing -> NaN)
 *   - any non-numeric value                  -> object  (`str`, missing -> None)
 *   - all-boolean                            -> bool
 * After that, py-icare's own casting (the reference `allow_integers=False`
 * float-cast, the reference->profile dtype coupling) makes the object sink
 * byte-for-byte identical to the byte/FS (`read_csv`) route.
 *
 * Numeric TypedArrays cross to Python via the buffer protocol (one copy); string
 * columns cross as lists. `null`/`undefined`/`NaN` become `NaN` in numeric
 * columns and `None` in string columns (matching the output marshaller's
 * `None if pd.isna(v) else str(v)` convention).
 */

import type { ColumnarTable, RowTable } from '../api/types';
import { ICAREError } from '../util/errors';

/** pandas dtype tag understood by `bridge.py` `build_df`. */
export type DType = 'f8' | 'i8' | 'bool' | 'str';

/** A dtype-tagged columnar frame for the object-sink input path. */
export interface FramePayload {
  /** Column name -> a sequence `toPy` converts (TypedArray, number[], (string|null)[], boolean[]). */
  columns: Record<string, unknown>;
  /** Column name -> pandas dtype tag. */
  dtypes: Record<string, DType>;
}

function isFloatArray(value: unknown): value is Float32Array | Float64Array {
  return value instanceof Float64Array || value instanceof Float32Array;
}

function isIntArray(value: unknown): boolean {
  return (
    value instanceof Int8Array ||
    value instanceof Int16Array ||
    value instanceof Int32Array ||
    value instanceof Uint8Array ||
    value instanceof Uint8ClampedArray ||
    value instanceof Uint16Array ||
    value instanceof Uint32Array ||
    (typeof BigInt64Array !== 'undefined' && value instanceof BigInt64Array) ||
    (typeof BigUint64Array !== 'undefined' && value instanceof BigUint64Array)
  );
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));
}

/** float64 column: `null`/`undefined`/`NaN` -> `NaN`; emitted as a `Float64Array`. */
function toFloatColumn(values: ArrayLike<unknown>): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    out[i] = isMissing(v) ? Number.NaN : Number(v);
  }
  return out;
}

/** object column: missing -> `null` (-> Python `None`), else `String(v)`. */
function toStringColumn(values: ArrayLike<unknown>): (string | null)[] {
  const out: (string | null)[] = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    out[i] = isMissing(v) ? null : String(v);
  }
  return out;
}

/**
 * Infer the dtype of a plain array (a columnar `number[]`/`string[]`, or a
 * row-array column of mixed values) following `read_csv` precedence.
 */
function inferArrayColumn(values: ArrayLike<unknown>): { data: unknown; dtype: DType } {
  let sawString = false;
  let sawBoolean = false;
  let sawNumber = false;
  let sawFractional = false;
  let sawMissing = false;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (isMissing(v)) {
      sawMissing = true;
    } else if (typeof v === 'string') {
      sawString = true;
    } else if (typeof v === 'boolean') {
      sawBoolean = true;
    } else if (typeof v === 'bigint') {
      sawNumber = true;
    } else if (typeof v === 'number') {
      sawNumber = true;
      if (!Number.isInteger(v)) sawFractional = true;
    } else {
      sawString = true; // objects/symbols -> stringify (object column)
    }
  }
  // Any non-numeric value makes it an object column (matches read_csv).
  if (sawString) return { data: toStringColumn(values), dtype: 'str' };
  if (sawBoolean && !sawNumber && !sawMissing) {
    return { data: Array.from(values, (v) => Boolean(v)), dtype: 'bool' };
  }
  if (sawBoolean) return { data: toStringColumn(values), dtype: 'str' };
  // Numeric: a fractional value or any missing forces float64.
  if (sawFractional || sawMissing) return { data: toFloatColumn(values), dtype: 'f8' };
  return { data: Array.from(values, (v) => Number(v)), dtype: 'i8' };
}

/** Normalize one column value into `{ data, dtype }`. */
function normalizeColumn(value: unknown): { data: unknown; dtype: DType } {
  if (isFloatArray(value)) {
    // Float64Array already carries NaN for missing; widen Float32Array to f64.
    return { data: value instanceof Float64Array ? value : new Float64Array(value), dtype: 'f8' };
  }
  if (isIntArray(value)) {
    return { data: value, dtype: 'i8' };
  }
  if (Array.isArray(value)) {
    return inferArrayColumn(value);
  }
  throw new ICAREError(
    `unsupported column value: expected a typed array or array, got ${typeof value}`,
  );
}

/**
 * Turn a columnar table's `columns` map into a dtype-tagged `FramePayload`.
 * Preserves column insertion order.
 */
export function toFramePayload(columns: Record<string, unknown>): FramePayload {
  const outColumns: Record<string, unknown> = {};
  const dtypes: Record<string, DType> = {};
  for (const name of Object.keys(columns)) {
    const { data, dtype } = normalizeColumn(columns[name]);
    outColumns[name] = data;
    dtypes[name] = dtype;
  }
  return { columns: outColumns, dtypes };
}

/**
 * Columnarize an array-of-objects (the least-efficient in-memory form). Uses the
 * union of keys in first-seen order; a row missing a key contributes `null`.
 */
export function columnarizeRows(rows: RowTable): ColumnarTable['columns'] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const columns: Record<string, unknown[]> = {};
  for (const key of keys) {
    columns[key] = rows.map((row) =>
      Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null,
    );
  }
  return columns as ColumnarTable['columns'];
}
