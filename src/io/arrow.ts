/**
 * Opt-in Arrow input adapter. An `apache-arrow` `Table` crosses to Python as
 * Arrow IPC stream bytes and is rebuilt with `pyarrow` (which the caller must
 * load via `loadICARE({ packages: ['pyarrow'] })`).
 *
 * `apache-arrow` is an optional dependency, imported dynamically so the SDK
 * works without it; the table is detected structurally (no static import).
 */

import type { ArrowTable } from '../api/types';
import { ICAREError } from '../util/errors';

/** The object-sink frame for an Arrow input: Arrow IPC stream bytes. */
export interface ArrowFramePayload {
  arrow_ipc: Uint8Array;
}

/** Structural guard: an `apache-arrow` `Table` (has a `schema.fields[]` + `numRows`). */
export function isArrowTable(value: unknown): value is ArrowTable {
  if (value === null || typeof value !== 'object') return false;
  const { schema, numRows } = value as { schema?: unknown; numRows?: unknown };
  return (
    typeof numRows === 'number' &&
    schema !== null &&
    typeof schema === 'object' &&
    Array.isArray((schema as { fields?: unknown }).fields)
  );
}

/** Serialize an Arrow `Table` to IPC stream bytes via the optional `apache-arrow`. */
export async function toArrowFramePayload(table: ArrowTable): Promise<ArrowFramePayload> {
  let tableToIPC: (table: unknown) => Uint8Array;
  try {
    ({ tableToIPC } = (await import('apache-arrow')) as unknown as {
      tableToIPC: (table: unknown) => Uint8Array;
    });
  } catch (error) {
    throw new ICAREError(
      "Arrow input requires the optional 'apache-arrow' package; install it to pass Arrow tables.",
      { cause: error },
    );
  }
  return { arrow_ipc: tableToIPC(table) };
}
