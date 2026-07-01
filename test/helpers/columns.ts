/**
 * Parse a fixture CSV into a {@link ColumnarTable}, reproducing pandas
 * `read_csv` column-dtype inference so the object-sink (columnar) input route
 * produces the same DataFrame dtypes as the byte/FS (`read_csv`) route:
 *   - every non-empty cell an integer, none missing -> `number[]` (int64)
 *   - every cell numeric, some fractional or missing -> `Float64Array` (float64)
 *   - any non-numeric cell                            -> `string[]` (object)
 * Empty cells are treated as missing (`NaN` for numeric, `null` for object).
 */

import { readFileSync } from 'node:fs';

import type { ColumnarTable } from '../../src/api/types';

function inferColumn(cells: string[]): Float64Array | number[] | string[] {
  let allNumeric = true;
  let allInteger = true;
  let anyPresent = false;
  for (const cell of cells) {
    if (cell === '') continue; // missing
    anyPresent = true;
    const n = Number(cell);
    if (!Number.isFinite(n)) {
      allNumeric = false;
      break;
    }
    if (!Number.isInteger(n)) allInteger = false;
  }

  if (!allNumeric || !anyPresent) {
    // Object column: empty -> null (missing).
    return cells.map((cell) => (cell === '' ? null : cell)) as unknown as string[];
  }

  const hasMissing = cells.some((cell) => cell === '');
  if (allInteger && !hasMissing) {
    return cells.map((cell) => Number(cell)); // int64
  }
  const out = new Float64Array(cells.length);
  for (let i = 0; i < cells.length; i += 1) {
    out[i] = cells[i] === '' ? Number.NaN : Number(cells[i]);
  }
  return out;
}

export function csvToColumns(path: string): ColumnarTable {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0]!.split(',');
  const rows = lines.slice(1).map((line) => line.split(','));

  const columns: Record<string, Float64Array | number[] | string[]> = {};
  header.forEach((name, c) => {
    columns[name] = inferColumn(rows.map((row) => row[c] ?? ''));
  });
  return { columns };
}
