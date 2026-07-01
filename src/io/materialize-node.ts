/// <reference types="node" />
/**
 * Node input materializer — the only Node-specific piece of input handling (so
 * the facade stays env-neutral).
 *
 * `{ path }` inputs are read from the host FS and written into the Pyodide FS
 * (byte/FS sink); inline forms — a Patsy formula `string`, a log-OR object —
 * pass straight through to py-icare; columnar / row-array tables become an
 * object-sink `frame` (a pandas DataFrame built in the bridge). URL / File /
 * Blob inputs land in Phase 4b, Arrow tables in Phase 4c.
 */

import { readFile } from 'node:fs/promises';

import type { InputMaterializer, MaterializedInput } from '../api/icareFacade';
import type { Engine } from '../runtime/engine';
import { ICAREError } from '../util/errors';
import { basename } from './bytes';
import { columnarizeRows, toFramePayload } from './columnar';
import {
  isBlobInput,
  isColumnarInput,
  isPathInput,
  isRowTable,
  isUrlInput,
} from './guards';

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
    if (typeof input === 'string') {
      // Inline Patsy formula (or an already-resolved FS path string).
      return { via: 'kwarg', value: input };
    }
    if (isColumnarInput(input)) {
      return { via: 'frame', frame: toFramePayload(input.columns) };
    }
    if (isRowTable(input)) {
      return { via: 'frame', frame: toFramePayload(columnarizeRows(input)) };
    }
    if (
      kind === 'logOR' &&
      !isUrlInput(input) &&
      !isBlobInput(input) &&
      !isColumnarInput(input) &&
      !isRowTable(input)
    ) {
      // Inline log-odds-ratios mapping `{ name: number }`.
      return { via: 'kwarg', value: input };
    }
    throw new ICAREError(
      `Input for '${jsName}' is not supported yet — URL / File / Blob inputs land in ` +
        'Phase 4b, Arrow in Phase 4c. Use { path }, an inline formula / log-OR, or a ' +
        'columnar / row-array table.',
    );
  };
}
