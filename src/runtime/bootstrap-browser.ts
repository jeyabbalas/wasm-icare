/**
 * Browser runtime bootstrap — the counterpart to `bootstrap-node.ts`.
 *
 * Loads Pyodide from a URL rather than `node_modules`: it dynamically imports
 * `pyodide.mjs` from `indexURL` (the pinned jsDelivr CDN by default, or a
 * self-hosted mirror), installs the scientific stack + the pyicare wheel, and
 * returns the SAME env-neutral {@link Engine} the Node path does. Runs on the
 * main thread (`useWorker:false`) or inside the module worker.
 *
 * Imports only a TYPE from `pyodide` (erased at build), so the browser/worker
 * bundles never pull in the Node loader.
 */

import type { PyodideInterface } from 'pyodide';

import { ICAREError } from '../util/errors';
import { withRetry } from '../util/retry';
import {
  PYICARE_WHEEL_CDN_URL,
  PYODIDE_CDN_BASE_URL,
  PYODIDE_DEFAULT_PACKAGES,
} from './config';
import { createEngine, type Engine } from './engine';

/** The subset of Pyodide's `loadPyodide` we rely on (structural, to avoid a runtime dep). */
type LoadPyodide = (config: {
  indexURL: string;
  enableRunUntilComplete?: boolean;
}) => Promise<PyodideInterface>;

export interface BrowserBootstrapOptions {
  /** Base URL of a Pyodide distribution (self-hosted mirror). Defaults to the pinned CDN. */
  indexURL?: string;
  /** URL of the pyicare wheel. Defaults to the CDN copy in the published npm package. */
  pyicareWheelUrl?: string;
  /** Disable the CDN fallbacks; `indexURL` + `pyicareWheelUrl` then become required. */
  offline?: boolean;
  /** Extra Pyodide packages to load (e.g. `['pyarrow']`). */
  packages?: readonly string[];
}

export interface BrowserBootstrapDeps {
  /**
   * Import the Pyodide ESM module. Defaults to a dynamic `import(indexURL +
   * 'pyodide.mjs')`; injectable so the sequence can be exercised in Node against
   * the installed `pyodide` package (no browser, no network).
   */
  importPyodide?: (indexURL: string) => Promise<{ loadPyodide: LoadPyodide }>;
}

/**
 * Boot Pyodide in the browser, install the scientific stack + the vendored
 * pyicare wheel, and return a ready {@link Engine}.
 */
export async function bootstrapBrowserEngine(
  options: BrowserBootstrapOptions = {},
  deps: BrowserBootstrapDeps = {},
): Promise<Engine> {
  if (options.offline) {
    if (!options.indexURL) {
      throw new ICAREError('offline browser boot requires an explicit indexURL (a self-hosted Pyodide).');
    }
    if (!options.pyicareWheelUrl) {
      throw new ICAREError('offline browser boot requires an explicit pyicareWheelUrl (the vendored wheel).');
    }
  }

  const indexURL = options.indexURL ?? PYODIDE_CDN_BASE_URL;
  const wheelUrl = options.pyicareWheelUrl ?? PYICARE_WHEEL_CDN_URL;
  const importPyodide = deps.importPyodide ?? defaultImportPyodide;

  const { loadPyodide } = await importPyodide(indexURL);
  const pyodide = await loadPyodide({
    indexURL,
    // Bridge calls are synchronous, so WASM stack switching is never needed.
    enableRunUntilComplete: false,
  });

  // Scientific stack (lockfile packages resolve their `depends`), THEN the pyicare
  // wheel by URL — pure-Python with no dependency resolution, so its imports must
  // already be present. Mirrors the Node bootstrap exactly from here on. Wrapped in
  // `withRetry` so a transient CDN drop on a cold boot self-heals.
  await withRetry(() => pyodide.loadPackage([...PYODIDE_DEFAULT_PACKAGES, ...(options.packages ?? [])]));
  await withRetry(() => pyodide.loadPackage(wheelUrl));

  return createEngine(pyodide);
}

/** Dynamic-import `pyodide.mjs` from the resolved index URL (314.x ships native ESM). */
async function defaultImportPyodide(indexURL: string): Promise<{ loadPyodide: LoadPyodide }> {
  // `@vite-ignore`: this is a runtime URL, not a bundle-time dependency to resolve.
  return import(/* @vite-ignore */ `${indexURL}pyodide.mjs`) as Promise<{ loadPyodide: LoadPyodide }>;
}
