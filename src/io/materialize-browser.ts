/**
 * Browser input materializer — the counterpart to `materialize-node.ts`.
 *
 * Byte/FS sink: `{ url }` is `fetch`ed and `Blob`/`File` is read via
 * `arrayBuffer()`, then the raw bytes go into the Pyodide FS through the engine
 * client (an RPC write when the engine lives in a worker). Inline forms — a Patsy
 * formula `string`, a log-OR object — pass straight through. Columnar / row-array
 * / Arrow tables become an object-sink `frame`. `{ path }` is rejected: a browser
 * has no host filesystem.
 *
 * Transport-agnostic: identical whether the client is in-process or a worker.
 */

import type { InputMaterializer, MaterializedInput } from '../api/icareFacade';
import { ICAREError } from '../util/errors';
import type { EngineClient } from '../worker/transport';
import { isArrowTable, toArrowFramePayload } from './arrow';
import { basename } from './bytes';
import { columnarizeRows, toFramePayload } from './columnar';
import { isBlobInput, isColumnarInput, isPathInput, isRowTable, isUrlInput } from './guards';

/** Create a materializer bound to a ready engine client (main-thread reads → FS bytes). */
export function createBrowserMaterializer(client: EngineClient): InputMaterializer {
  return async (input, kind, jsName): Promise<MaterializedInput> => {
    if (input == null) {
      return { via: 'kwarg', value: input };
    }
    if (isPathInput(input)) {
      throw new ICAREError(
        `Input for '${jsName}' is a { path }, which a browser cannot read. Use { url }, ` +
          'a File/Blob, an inline formula / log-OR, or a columnar / row-array table.',
      );
    }
    if (isUrlInput(input)) {
      const bytes = await fetchUrlBytes(input.url);
      return { via: 'kwarg', value: await client.writeInputFile(urlName(input.url), bytes) };
    }
    if (isBlobInput(input)) {
      const bytes = new Uint8Array(await input.arrayBuffer());
      return { via: 'kwarg', value: await client.writeInputFile(blobName(input), bytes) };
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
      `Input for '${jsName}' is not a supported DataInput form. Use { url }, a File/Blob, ` +
        'an inline formula / log-OR, or a columnar / row-array table.',
    );
  };
}

/** Fetch a URL into raw bytes (http(s) or a same-origin relative path). */
async function fetchUrlBytes(url: string | URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    const href = typeof url === 'string' ? url : url.href;
    throw new ICAREError(`failed to fetch '${href}': ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Derive a filename from a URL, stripping any query/hash; falls back to `input`. */
function urlName(url: string | URL): string {
  const href = typeof url === 'string' ? url : url.href;
  const path = href.split(/[?#]/, 1)[0] ?? href;
  const name = basename(path);
  return name.length > 0 ? name : 'input';
}

/** A `File` carries a `name`; a bare `Blob` does not (falls back to `input`). */
function blobName(blob: Blob): string {
  const name = (blob as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : 'input';
}
