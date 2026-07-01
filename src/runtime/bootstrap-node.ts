/// <reference types="node" />
/**
 * Node.js runtime bootstrap — the ONLY module importing `pyodide` + `node:*`.
 *
 * Confined here (and re-exported solely from `index.node.ts`) so the neutral
 * and browser bundles never pull in Node built-ins or the Pyodide loader. The
 * filename avoids a `.node` infix so bundlers don't mistake internal imports for
 * native addons.
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { loadPyodide } from 'pyodide';
import type { PyodideInterface } from 'pyodide';

import { pyicareWheelPath, pyodideIndexPath } from './assets-node';
import { PYODIDE_DEFAULT_PACKAGES } from './config';
import { createEngine, type Engine } from './engine';

export interface NodeBootstrapOptions {
  /** Extra Pyodide packages to load (e.g. `['pyarrow']`). */
  packages?: readonly string[];
  /**
   * Directory Pyodide caches downloaded package wheels in. Defaults to
   * `.pyodide-cache` under `process.cwd()` (gitignored). The scientific stack
   * (numpy/pandas/scipy/patsy) is fetched from JsDelivr on the first boot and
   * cached here; the pyicare wheel is always local. Created if missing.
   */
  packageCacheDir?: string;
  /** Forwarded to Pyodide stdout. */
  stdout?: (message: string) => void;
  /** Forwarded to Pyodide stderr. */
  stderr?: (message: string) => void;
}

/**
 * Boot Pyodide, install the scientific stack + the vendored pyicare wheel, and
 * return a ready {@link Engine}. The public `loadICARE` wraps this in Phase 3.
 */
export async function bootstrapNodeEngine(
  options: NodeBootstrapOptions = {},
): Promise<Engine> {
  const packageCacheDir =
    options.packageCacheDir ?? resolve(process.cwd(), '.pyodide-cache');
  mkdirSync(packageCacheDir, { recursive: true });

  const pyodide: PyodideInterface = await loadPyodide({
    // Bridge calls are synchronous, so WASM stack switching is never needed —
    // avoids requiring Node's --experimental-wasm-stack-switching flag.
    enableRunUntilComplete: false,
    // Explicit indexURL → deterministic asset resolution from node_modules/pyodide
    // in every context (plain Node AND transform pipelines like Vitest).
    indexURL: pyodideIndexPath(),
    packageCacheDir,
    stdout: options.stdout,
    stderr: options.stderr,
  });

  // Scientific stack first (lockfile packages; their `depends` resolve too),
  // THEN the vendored pyicare wheel — installed by absolute path, so it is
  // offline and pure-Python with no dependency resolution, which is why its
  // imports (numpy/pandas/scipy/patsy) must already be present.
  await pyodide.loadPackage([...PYODIDE_DEFAULT_PACKAGES, ...(options.packages ?? [])]);
  await pyodide.loadPackage(pyicareWheelPath());

  return createEngine(pyodide);
}
