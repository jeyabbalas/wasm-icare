import { tableFromArrays } from 'apache-arrow';
import { describe, expect, test } from 'vitest';

import { isArrowTable, toArrowFramePayload } from '../../src/io/arrow';

describe('isArrowTable', () => {
  test('accepts an apache-arrow Table', () => {
    const table = tableFromArrays({ age: Int32Array.from([1, 2, 3]) });
    expect(isArrowTable(table)).toBe(true);
  });

  test('rejects columnar tables, arrays, and non-objects', () => {
    expect(isArrowTable({ columns: { a: [1] } })).toBe(false);
    expect(isArrowTable([{ a: 1 }])).toBe(false);
    expect(isArrowTable(null)).toBe(false);
    expect(isArrowTable('y ~ x')).toBe(false);
    expect(isArrowTable({ schema: {}, numRows: 3 })).toBe(false); // no schema.fields[]
  });
});

describe('toArrowFramePayload', () => {
  test('serializes to non-empty Arrow IPC bytes', async () => {
    const table = tableFromArrays({
      id: ['a', 'b'],
      x: Float64Array.from([1.5, 2.5]),
    });
    const payload = await toArrowFramePayload(table);
    expect(payload.arrow_ipc).toBeInstanceOf(Uint8Array);
    expect(payload.arrow_ipc.length).toBeGreaterThan(0);
  });
});
