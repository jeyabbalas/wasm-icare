/// <reference types="node" />
/**
 * Node input materializer — the only Node-specific piece of input handling (so
 * the facade stays env-neutral).
 *
 * Byte/FS sink: `{ path }` (host file), `{ url }` (`file://` read, `http(s)://`
 * fetch), and `Blob`/`File` are read into raw bytes and written into the Pyodide
 * FS; py-icare then reads them with the unchanged `read_csv`/`read_*` path.
 * Inline forms — a Patsy formula `string`, a log-OR object — pass straight
 * through. Columnar / row-array tables and `apache-arrow` tables become an
 * object-sink `frame` (a pandas DataFrame built in the bridge).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { InputMaterializer, MaterializedInput } from '../api/icareFacade';
import type { Engine } from '../runtime/engine';
import { ICAREError } from '../util/errors';
import { isArrowTable, toArrowFramePayload } from './arrow';
import { basename } from './bytes';
import { columnarizeRows, toFramePayload } from './columnar';
import { isBlobInput, isColumnarInput, isPathInput, isRowTable, isUrlInput } from './guards';

/** Create a materializer bound to a ready engine's Pyodide FS. */
export function createNodeMaterializer(engine: Engine): InputMaterializer {
  return async (input, kind, jsName): Promise<MaterializedInput> => {
    if (input == null) {
      return { via: 'kwarg', value: input };
    }
    if (isPathInput(input)) {
      const bytes = await readFile(input.path);
      return { via: 'kwarg', value: engine.writeInputFile(basename(input.path), bytes) };
    }
    if (isUrlInput(input)) {
      const { bytes, name } = await readUrlBytes(input.url);
      return { via: 'kwarg', value: engine.writeInputFile(name, bytes) };
    }
    if (isBlobInput(input)) {
      const bytes = new Uint8Array(await input.arrayBuffer());
      return { via: 'kwarg', value: engine.writeInputFile(blobName(input), bytes) };
    }
    if (typeof input === 'string') {
      // Inline Patsy formula (or an already-resolved FS path string).
      return { via: 'kwarg', value: input };
    }
    if (isArrowTable(input)) {
      return { via: 'frame', frame: await toArrowFramePayload(input) };
    }
    if (isColumnarInput(input)) {
      return { via: 'frame', frame: toFramePayload(input.columns) };
    }
    if (isRowTable(input)) {
      return { via: 'frame', frame: toFramePayload(columnarizeRows(input)) };
    }
    if (kind === 'logOR') {
      // Inline log-odds-ratios mapping `{ name: number }`.
      return { via: 'kwarg', value: input };
    }
    throw new ICAREError(
      `Input for '${jsName}' is not a supported DataInput form. Use { path }, ` +
        '{ url }, a File/Blob, an inline formula / log-OR, or a columnar / row-array table.',
    );
  };
}

/** Read a URL into raw bytes: `file://` from the host FS, `http(s)://` via fetch. */
async function readUrlBytes(url: string | URL): Promise<{ bytes: Uint8Array; name: string }> {
  const resolved = typeof url === 'string' ? new URL(url) : url;
  if (resolved.protocol === 'file:') {
    const path = fileURLToPath(resolved);
    return { bytes: await readFile(path), name: basename(path) };
  }
  if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
    const response = await fetch(resolved);
    if (!response.ok) {
      throw new ICAREError(
        `failed to fetch '${resolved.href}': ${response.status} ${response.statusText}`,
      );
    }
    const buffer = await response.arrayBuffer();
    return { bytes: new Uint8Array(buffer), name: basename(resolved.pathname) };
  }
  throw new ICAREError(`unsupported URL protocol '${resolved.protocol}' for '${resolved.href}'.`);
}

/** A `File` carries a `name`; a bare `Blob` does not (the FS sink falls back to `input`). */
function blobName(blob: Blob): string {
  const name = (blob as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : 'input';
}
