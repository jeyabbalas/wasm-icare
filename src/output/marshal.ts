/**
 * Output marshalling — turn a py-icare 'dataframe'-mode result (already reshaped
 * by the Python bridge's `columnarize`) into a plain JS tree with typed-array
 * columns.
 *
 * The bridge hands back `{ structure, buffers }`:
 *  - `structure` is fully JSON-native (no numpy arrays), so one `toJs` converts
 *    it. Numeric columns appear as `{ __icare_array__: true, dtype, shape,
 *    index }` nodes that reference `buffers` by index.
 *  - `buffers` is a flat list of ndarray proxies extracted zero-copy (see
 *    `buffers.ts`).
 *
 * `spliceArrays` walks the native `structure` and swaps each array node for its
 * extracted `NumericColumn`, so no PyProxy tree-walking is needed.
 */

import type { PyProxy } from 'pyodide/ffi';

import type { CategoricalColumn } from '../api/types';
import { extractArray, type NumericColumn } from './buffers';

// Must match the marker keys emitted by `bridge.py` `columnarize`.
const ARRAY_MARK = '__icare_array__';
const FRAME_MARK = '__icare_frame__';
const STRINGS_MARK = '__icare_strings__';
const CATEGORICAL_MARK = '__icare_categorical__';

/** A marshalled DataFrame: named columns + original column order + row count. */
export interface ColumnarFrame {
  columns: Record<string, NumericColumn | (string | null)[] | CategoricalColumn>;
  order: string[];
  nRows: number;
}

/**
 * Convert the bridge's `columnarize` result (a `{ structure, buffers }` dict
 * proxy) into a plain JS tree. Every transient proxy created here is destroyed
 * before returning; the returned arrays are JS-owned copies.
 */
export function marshalColumnarResult(columnar: PyProxy): unknown {
  const top = columnar.toJs({ depth: 1, dict_converter: Object.fromEntries }) as {
    structure: PyProxy;
    buffers: PyProxy;
  };
  const { structure: structureProxy, buffers: buffersProxy } = top;
  try {
    const bufferProxies = buffersProxy.toJs({ depth: 1 }) as PyProxy[];
    try {
      const structure = structureProxy.toJs({ dict_converter: Object.fromEntries });
      return spliceArrays(structure, bufferProxies);
    } finally {
      for (const proxy of bufferProxies) proxy.destroy();
    }
  } finally {
    structureProxy.destroy();
    buffersProxy.destroy();
  }
}

/**
 * Recursively replace array/frame/strings/categorical marker nodes with plain JS
 * values. Exported (`@internal`) so unit tests can drive it with a fake buffer.
 */
export function spliceArrays(node: unknown, buffers: PyProxy[]): unknown {
  if (Array.isArray(node)) {
    return node.map((child) => spliceArrays(child, buffers));
  }
  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj[ARRAY_MARK] === true) {
      return extractArray(buffers[obj.index as number] as PyProxy, obj.dtype as string);
    }
    if (obj[STRINGS_MARK] === true) {
      return obj.data;
    }
    if (obj[CATEGORICAL_MARK] === true) {
      // Codes arrive as an ARRAY_MARK node (int8/16/32 → `number[]`); normalize to
      // a compact Int32Array, preserving `-1` (missing). `categories` are inline.
      const codes = spliceArrays(obj.codes, buffers) as NumericColumn;
      return {
        codes: Int32Array.from(codes as ArrayLike<number>),
        categories: obj.categories as string[],
      } satisfies CategoricalColumn;
    }
    if (obj[FRAME_MARK] === true) {
      const columnsNode = obj.columns as Record<string, unknown>;
      const columns: Record<string, unknown> = {};
      for (const key of Object.keys(columnsNode)) {
        columns[key] = spliceArrays(columnsNode[key], buffers);
      }
      return { columns, order: obj.order, nRows: obj.n_rows };
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = spliceArrays(obj[key], buffers);
    }
    return out;
  }
  return node;
}
