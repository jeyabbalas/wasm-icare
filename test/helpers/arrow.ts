/**
 * Build an `apache-arrow` Table from a fixture CSV, reusing {@link csvToColumns}'
 * read_csv-matching inference. Integer columns are emitted as Arrow `Int64` (via
 * `BigInt64Array`) so `to_pandas()` yields int64 — not float64, which would
 * stringify an integer-looking categorical ('0') to '0.0'. Text columns are
 * `string[]` (Arrow dictionary-encoded; `build_df_from_arrow` normalizes them to
 * the `str` dtype).
 */

import { tableFromArrays, type Table } from 'apache-arrow';

import { csvToColumns } from './columns';

export function csvToArrowTable(path: string): Table {
  const { columns } = csvToColumns(path);
  const arrays: Record<string, Float64Array | BigInt64Array | (string | null)[]> = {};
  for (const name of Object.keys(columns)) {
    const col = columns[name]!;
    if (col instanceof Float64Array) {
      arrays[name] = col; // float64
    } else if ((col as unknown[]).some((v) => typeof v === 'string')) {
      arrays[name] = col as (string | null)[]; // text
    } else {
      arrays[name] = BigInt64Array.from((col as number[]).map((v) => BigInt(v))); // int64
    }
  }
  return tableFromArrays(arrays);
}
