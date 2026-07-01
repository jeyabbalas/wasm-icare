import { describe, expect, test } from 'vitest';

import { columnarizeRows, toFramePayload } from '../../src/io/columnar';

describe('toFramePayload — dtype inference (reproduces read_csv rules)', () => {
  test('Float64Array -> f8, values preserved (incl. NaN)', () => {
    const { columns, dtypes } = toFramePayload({ x: new Float64Array([1.5, Number.NaN, 3]) });
    expect(dtypes.x).toBe('f8');
    const x = columns.x as Float64Array;
    expect(x).toBeInstanceOf(Float64Array);
    expect(x[0]).toBe(1.5);
    expect(Number.isNaN(x[1] as number)).toBe(true);
    expect(x[2]).toBe(3);
  });

  test('Float32Array -> f8, widened to Float64Array', () => {
    const { columns, dtypes } = toFramePayload({ x: new Float32Array([0.5, 2]) });
    expect(dtypes.x).toBe('f8');
    const x = columns.x as Float64Array;
    expect(x).toBeInstanceOf(Float64Array);
    expect(Array.from(x)).toEqual([0.5, 2]);
  });

  test('Int32Array -> i8', () => {
    const { columns, dtypes } = toFramePayload({ age: new Int32Array([40, 45, 50]) });
    expect(dtypes.age).toBe('i8');
    expect(columns.age).toBeInstanceOf(Int32Array);
  });

  test('number[] all-integer -> i8', () => {
    const { columns, dtypes } = toFramePayload({ n: [1, 2, 3] });
    expect(dtypes.n).toBe('i8');
    expect(columns.n).toEqual([1, 2, 3]);
  });

  test('number[] with a fractional value -> f8', () => {
    const { columns, dtypes } = toFramePayload({ n: [1, 2.5, 3] });
    expect(dtypes.n).toBe('f8');
    expect(Array.from(columns.n as Float64Array)).toEqual([1, 2.5, 3]);
  });

  test('number[] with a missing value -> f8, null/NaN -> NaN', () => {
    const { columns, dtypes } = toFramePayload({ n: [1, null as unknown as number, 3] });
    expect(dtypes.n).toBe('f8');
    const n = columns.n as Float64Array;
    expect(n[0]).toBe(1);
    expect(Number.isNaN(n[1] as number)).toBe(true);
    expect(n[2]).toBe(3);
  });

  test('string[] -> str, null preserved', () => {
    const { columns, dtypes } = toFramePayload({ s: ['a', null as unknown as string, 'c'] });
    expect(dtypes.s).toBe('str');
    expect(columns.s).toEqual(['a', null, 'c']);
  });

  test('boolean[] -> bool', () => {
    const { columns, dtypes } = toFramePayload({ b: [true, false, true] });
    expect(dtypes.b).toBe('bool');
    expect(columns.b).toEqual([true, false, true]);
  });

  test('a numeric-looking column with any string value -> str (object)', () => {
    const { dtypes } = toFramePayload({ mixed: [1, '2', 3] });
    expect(dtypes.mixed).toBe('str');
  });

  test('column insertion order is preserved', () => {
    const { columns } = toFramePayload({ c: [1], a: [2], b: [3] });
    expect(Object.keys(columns)).toEqual(['c', 'a', 'b']);
  });
});

describe('columnarizeRows — array-of-objects -> columns', () => {
  test('union of keys in first-seen order, then dtype inference', () => {
    const rows = [
      { id: 1, age: 40, label: 'x' },
      { id: 2, age: 45.5, label: 'y' },
    ];
    const columns = columnarizeRows(rows);
    expect(Object.keys(columns)).toEqual(['id', 'age', 'label']);

    const { dtypes } = toFramePayload(columns);
    expect(dtypes.id).toBe('i8');
    expect(dtypes.age).toBe('f8'); // 45.5 forces float
    expect(dtypes.label).toBe('str');
  });

  test('a row missing a key contributes null (-> NaN / None)', () => {
    const rows = [{ a: 1, b: 2 }, { a: 3 }];
    const columns = columnarizeRows(rows);
    expect(columns.a).toEqual([1, 3]);
    expect(columns.b).toEqual([2, null]);

    const { columns: framed, dtypes } = toFramePayload(columns);
    expect(dtypes.b).toBe('f8'); // missing value forces float
    const b = framed.b as Float64Array;
    expect(b[0]).toBe(2);
    expect(Number.isNaN(b[1] as number)).toBe(true);
  });

  test('empty rows -> no columns', () => {
    expect(columnarizeRows([])).toEqual({});
  });
});
