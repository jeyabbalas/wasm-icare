/**
 * Byte/FS sink — write input bytes into the Pyodide FS so py-icare reads them
 * with its unchanged `read_csv` / `open` / `json.load` path. This preserves
 * exact dtype inference (required for mixed covariate/reference data), which a
 * naive columnar object sink would not.
 *
 * Env-neutral: uses only `pyodide.FS`. Phase 4's URL / Blob inputs reuse
 * `writeInputBytes` verbatim (fetch/arrayBuffer → bytes → write).
 */

import type { PyodideInterface } from 'pyodide';

import { sanitizeFsName } from './bytes';

const INPUT_DIR = '/icare/inputs';
let sequence = 0;

/**
 * Write raw bytes into the Pyodide FS and return the resulting path. Bytes are
 * written directly (no UTF-16 string step). A monotonic prefix keeps same-named
 * inputs from colliding across calls. `mkdirTree` is idempotent, so it is safe
 * to call per write (and across multiple Pyodide instances in one process).
 */
export function writeInputBytes(
  pyodide: PyodideInterface,
  name: string,
  bytes: Uint8Array,
): string {
  pyodide.FS.mkdirTree(INPUT_DIR);
  const path = `${INPUT_DIR}/${sequence++}_${sanitizeFsName(name)}`;
  pyodide.FS.writeFile(path, bytes);
  return path;
}
