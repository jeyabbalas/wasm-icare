/**
 * Parse a fixture CSV into a {@link ColumnarTable}, reproducing pandas
 * `read_csv` column-dtype inference so the object-sink (columnar) input route
 * produces the same DataFrame dtypes as the byte/FS (`read_csv`) route:
 *   - every non-empty cell an integer, none missing  -> `number[]` (int64)
 *   - every cell numeric, some fractional/inf/missing -> `Float64Array` (float64)
 *   - any non-numeric cell                            -> `string[]` (object)
 * Empty cells are treated as missing (`NaN` for numeric, `null` for object), and
 * `inf` / `-inf` / `Infinity` tokens parse to `±Infinity` (as `read_csv` does —
 * e.g. the validation study's `time_of_onset` column for censored subjects).
 */

import { readFileSync } from 'node:fs';

import type { ColumnarTable, RowTable } from '../../src/api/types';

/** pandas' default positive/negative-infinity tokens. */
const INFINITY_TOKEN = /^[+-]?inf(inity)?$/i;

/** Parse a numeric cell (incl. inf); `''` and non-numeric text -> `NaN`. */
function parseNumeric(cell: string): number {
  if (cell === '') return Number.NaN;
  if (INFINITY_TOKEN.test(cell)) return cell[0] === '-' ? -Infinity : Infinity;
  return Number(cell);
}

function inferColumn(cells: string[]): Float64Array | number[] | string[] {
  let allNumeric = true;
  let allInteger = true;
  let anyPresent = false;
  for (const cell of cells) {
    if (cell === '') continue; // missing
    anyPresent = true;
    if (INFINITY_TOKEN.test(cell)) {
      allInteger = false; // ±inf is numeric but not an integer
      continue;
    }
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
    out[i] = parseNumeric(cells[i]!);
  }
  return out;
}

/** Strip surrounding double-quotes from a header name (some R exports quote them). */
function stripHeaderQuotes(name: string): string {
  return name.replace(/^"(.*)"$/, '$1');
}

export function csvToColumns(path: string): ColumnarTable {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0]!.split(',').map(stripHeaderQuotes);
  const rows = lines.slice(1).map((line) => line.split(','));

  const columns: Record<string, Float64Array | number[] | string[]> = {};
  header.forEach((name, c) => {
    columns[name] = inferColumn(rows.map((row) => row[c] ?? ''));
  });
  return { columns };
}

/**
 * Transpose a {@link ColumnarTable} into an array-of-objects (row-oriented),
 * preserving each column's inferred value types. Feeds the row-array input form.
 */
export function columnsToRows(table: ColumnarTable): RowTable {
  const names = Object.keys(table.columns);
  const nRows = names.length > 0 ? (table.columns[names[0]!] as ArrayLike<unknown>).length : 0;
  const rows: RowTable = [];
  for (let i = 0; i < nRows; i += 1) {
    const row: Record<string, unknown> = {};
    for (const name of names) {
      row[name] = (table.columns[name] as ArrayLike<unknown>)[i];
    }
    rows.push(row);
  }
  return rows;
}
