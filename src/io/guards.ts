/**
 * Type guards that classify a `DataInput` wrapper shape. Foundational for input
 * dispatch; Phase 3 uses them to accept `{ path }` and reject (with a clear
 * error) the URL / File / Blob / columnar / row-array forms that land in Phase 4.
 */

import type { ColumnarTable, PathInput, RowTable, UrlInput } from '../api/types';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** `{ path: string }` — a filesystem path source (Node). */
export function isPathInput(value: unknown): value is PathInput {
  return isObject(value) && typeof value.path === 'string';
}

/** `{ url: string | URL }` — a fetchable source. */
export function isUrlInput(value: unknown): value is UrlInput {
  if (!isObject(value)) return false;
  const { url } = value;
  return typeof url === 'string' || url instanceof URL;
}

/** `{ columns: {...} }` — an in-memory columnar table. */
export function isColumnarInput(value: unknown): value is ColumnarTable {
  return isObject(value) && isObject(value.columns);
}

/** A `Blob`/`File` source (guarded for runtimes without `Blob`). */
export function isBlobInput(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

/** An array-of-objects (row-oriented) table. */
export function isRowTable(value: unknown): value is RowTable {
  return Array.isArray(value);
}
