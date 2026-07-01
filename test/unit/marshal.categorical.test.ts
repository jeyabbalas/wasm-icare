import type { PyProxy } from 'pyodide/ffi';
import { describe, expect, test } from 'vitest';

import { spliceArrays } from '../../src/output/marshal';
import type { CategoricalColumn } from '../../src/api/types';

/**
 * A fake ndarray proxy: `getBuffer()` hands back a fixed TypedArray view (as
 * Pyodide's `getBuffer` would) with a no-op `release()`. Lets the marshaller's
 * categorical branch be exercised without booting Pyodide.
 */
function fakeBuffer(data: ArrayLike<number> & Iterable<number>): PyProxy {
  return {
    getBuffer() {
      return { data, release() {} };
    },
  } as unknown as PyProxy;
}

describe('spliceArrays — categorical column marshalling', () => {
  test('__icare_categorical__ node -> { codes: Int32Array, categories }, -1 preserved', () => {
    const node = {
      linear_predictors_category: {
        __icare_categorical__: true,
        // Codes come across as an ARRAY_MARK node (pandas cat.codes is int8).
        codes: { __icare_array__: true, dtype: 'int8', shape: [4], index: 0 },
        categories: ['(-0.1, 0.2]', '(0.2, 0.5]', '(0.5, 0.9]'],
      },
    };
    // A missing value is code -1; two rows share category 0.
    const buffers = [fakeBuffer(new Int8Array([0, 2, -1, 0]))];

    const result = spliceArrays(node, buffers) as Record<string, CategoricalColumn>;
    const col = result.linear_predictors_category!;

    expect(col.codes).toBeInstanceOf(Int32Array);
    expect(Array.from(col.codes)).toEqual([0, 2, -1, 0]); // -1 (missing) preserved
    expect(col.categories).toEqual(['(-0.1, 0.2]', '(0.2, 0.5]', '(0.5, 0.9]']);
  });

  test('a categorical column nested inside a frame node marshals in place', () => {
    const node = {
      __icare_frame__: true,
      order: ['risk', 'bucket'],
      n_rows: 2,
      columns: {
        risk: { __icare_array__: true, dtype: 'float64', shape: [2], index: 0 },
        bucket: {
          __icare_categorical__: true,
          codes: { __icare_array__: true, dtype: 'int8', shape: [2], index: 1 },
          categories: ['low', 'high'],
        },
      },
    };
    const buffers = [fakeBuffer(new Float64Array([0.1, 0.9])), fakeBuffer(new Int8Array([0, 1]))];

    const frame = spliceArrays(node, buffers) as {
      columns: { risk: Float64Array; bucket: CategoricalColumn };
      order: string[];
      nRows: number;
    };

    expect(frame.nRows).toBe(2);
    expect(frame.order).toEqual(['risk', 'bucket']);
    expect(frame.columns.risk).toBeInstanceOf(Float64Array);
    expect(frame.columns.bucket.codes).toBeInstanceOf(Int32Array);
    expect(Array.from(frame.columns.bucket.codes)).toEqual([0, 1]);
    expect(frame.columns.bucket.categories).toEqual(['low', 'high']);
  });
});
