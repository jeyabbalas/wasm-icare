/**
 * Zero-copy extraction of numpy ndarrays into JS-owned numeric arrays.
 *
 * The Python bridge's `columnarize` returns a flat `buffers` list of
 * C-contiguous ndarrays. Each is read here through the Pyodide buffer protocol
 * (`getBuffer` → a `PyBufferView` over WASM memory), copied out with `.slice()`
 * / a numeric map (so the result is owned by JS and stays valid after the proxy
 * is destroyed), and the view is released immediately.
 */

import type { PyBuffer, PyProxy } from 'pyodide/ffi';

/** A numeric column as returned to callers: fast path for float64, else numbers. */
export type NumericColumn = Float64Array | number[];

/**
 * numpy dtype string → the explicit `getBuffer` output type. Passing the type
 * makes the returned `TypedArray` deterministic (rather than relying on format
 * auto-detection); notably `int64` → `i64` yields a `BigInt64Array`, which we
 * normalize to `number[]` below.
 */
const BUFFER_TYPE: Readonly<Record<string, string>> = {
  float64: 'f64',
  float32: 'f32',
  int64: 'i64',
  int32: 'i32',
  int16: 'i16',
  int8: 'i8',
  uint64: 'u64',
  uint32: 'u32',
  uint16: 'u16',
  uint8: 'u8',
};

/**
 * Copy one ndarray proxy out of the WASM heap. `float64` → `Float64Array` (the
 * hot path for risks / linear predictors / population risks); every other dtype
 * (e.g. `int64` age columns) → a plain `number[]` (BigInt values normalized to
 * JS numbers). The buffer view is always released.
 */
export function extractArray(proxy: PyProxy, dtype: string): NumericColumn {
  const buffer = (proxy as PyBuffer).getBuffer(BUFFER_TYPE[dtype]);
  try {
    const { data } = buffer;
    if (data instanceof Float64Array) {
      return data.slice();
    }
    const out: number[] = [];
    for (const value of data) {
      out.push(Number(value));
    }
    return out;
  } finally {
    buffer.release();
  }
}
