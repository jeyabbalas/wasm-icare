/// <reference types="node" />
/**
 * Node input materializer — the only Node-specific piece of input handling (so
 * the facade stays env-neutral).
 *
 * `{ path }` inputs are read from the host FS and written into the Pyodide FS
 * (byte/FS sink); inline forms — a Patsy formula `string`, a log-OR object —
 * pass straight through to py-icare. URL / File / Blob / columnar / row-array
 * inputs are Phase 4 and raise a clear error.
 */

import { readFile } from 'node:fs/promises';

import type { InputMaterializer } from '../api/icareFacade';
import type { Engine } from '../runtime/engine';
import { ICAREError } from '../util/errors';
import { basename } from './bytes';
import {
  isBlobInput,
  isColumnarInput,
  isPathInput,
  isRowTable,
  isUrlInput,
} from './guards';

/** Create a materializer bound to a ready engine's Pyodide FS. */
export function createNodeMaterializer(engine: Engine): InputMaterializer {
  return async (input, kind, jsName) => {
    if (input == null) {
      return input;
    }
    if (isPathInput(input)) {
      const bytes = await readFile(input.path);
      return engine.writeInputFile(basename(input.path), bytes);
    }
    if (typeof input === 'string') {
      // Inline Patsy formula (or an already-resolved FS path string).
      return input;
    }
    if (
      kind === 'logOR' &&
      !isUrlInput(input) &&
      !isColumnarInput(input) &&
      !isBlobInput(input) &&
      !isRowTable(input)
    ) {
      // Inline log-odds-ratios mapping `{ name: number }`.
      return input;
    }
    throw new ICAREError(
      `Input for '${jsName}' is not supported yet — URL / File / Blob / columnar / ` +
        'row-array inputs land in Phase 4. Use { path } (or an inline formula / log-OR).',
    );
  };
}
