/// <reference types="node" />
/**
 * Node-only asset resolution.
 *
 * Kept out of the neutral/browser bundle (it imports `node:module`); only
 * `bootstrap-node.ts` → `index.node.ts` reaches it. The filename avoids a
 * `.node` infix so bundlers don't mistake the import for a native addon.
 */

import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { PYICARE_WHEEL_FILENAME } from './config';

const nodeRequire = createRequire(import.meta.url);

/**
 * Absolute filesystem path to the vendored pyicare wheel.
 *
 * Resolved via the package's own `./assets/*` export (self-reference), so it is
 * correct in BOTH dev (vitest running from `src/`) and the installed `dist/`
 * layout — the relative depth differs, but resolving by package name does not.
 * Works on Node 18+ (avoids `import.meta.resolve`, stable only on 20.6+).
 */
export function pyicareWheelPath(): string {
  return nodeRequire.resolve(`wasm-icare/assets/wheels/${PYICARE_WHEEL_FILENAME}`);
}

/**
 * Explicit Pyodide `indexURL` — the installed `pyodide` package directory as an
 * absolute filesystem path with a trailing slash (Pyodide path-joins asset
 * names onto it).
 *
 * Passing this beats Pyodide's auto-detection, which breaks when the loader is
 * run through a transform pipeline (e.g. Vitest maps `import.meta.url` back to
 * Pyodide's sourcemap-original `src/js/` path, so assets resolve under
 * `node_modules/src/js/` and 404). A plain absolute path (not a `file://` URL)
 * is required: Pyodide feeds it through `path.resolve`, and a non-`/`-prefixed
 * `file://` string would be treated as relative and prepended with `cwd`.
 */
export function pyodideIndexPath(): string {
  const pyodideDir = dirname(nodeRequire.resolve('pyodide/package.json'));
  return `${pyodideDir}/`;
}
