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
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';
import type { PyodideInterface } from 'pyodide';

import { ICAREError } from '../util/errors';
import { withRetry } from '../util/retry';
import { pyicareWheelPath, pyodideIndexPath } from './assets-node';
import { PYODIDE_DEFAULT_PACKAGES } from './config';
import { createEngine, type Engine } from './engine';

export interface NodeBootstrapOptions {
  /**
   * Base directory (or `file://` URL) of a self-hosted Pyodide distribution —
   * e.g. a mirror from `npx wasm-icare-vendor <dir>`. Defaults to the installed
   * `node_modules/pyodide`. Point it at a mirror that also carries the scientific
   * wheels to boot without touching the network.
   */
  indexURL?: string;
  /** Override path/URL for the pyicare wheel. Defaults to the vendored wheel. */
  pyicareWheelUrl?: string;
  /**
   * Require fully self-hosted assets (no CDN fallback). `indexURL` **and**
   * `pyicareWheelUrl` become required, and `indexURL` must resolve the scientific
   * wheels locally — the bundled `node_modules/pyodide` ships only the core
   * runtime. Mirrors the browser bootstrap's guard.
   */
  offline?: boolean;
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
  if (options.offline) {
    // Same contract as the browser: offline demands explicit self-hosted assets.
    // The default node_modules/pyodide indexURL carries only the core runtime, so
    // its scientific wheels would fall back to the jsDelivr CDN — not offline.
    if (!options.indexURL) {
      throw new ICAREError(
        'offline Node boot requires an explicit indexURL (a self-hosted Pyodide mirror ' +
          'with the scientific wheels, e.g. from `npx wasm-icare-vendor <dir>`).',
      );
    }
    if (!options.pyicareWheelUrl) {
      throw new ICAREError('offline Node boot requires an explicit pyicareWheelUrl (the vendored wheel).');
    }
  }

  // The package cache is where Node loads scientific wheels from (checked before
  // any download). Default `.pyodide-cache` warms from the CDN on first boot; for
  // an offline mirror, point it AT the mirror so the wheels resolve locally — this
  // covers both resolution paths (cache hit, or the CDN fallback whose base URL is
  // itself the mirror's `indexURL`).
  const packageCacheDir =
    options.packageCacheDir ??
    (options.offline && options.indexURL
      ? indexUrlToDir(options.indexURL)
      : resolve(process.cwd(), '.pyodide-cache'));
  mkdirSync(packageCacheDir, { recursive: true });

  const pyodide: PyodideInterface = await loadPyodide({
    // Bridge calls are synchronous, so WASM stack switching is never needed —
    // avoids requiring Node's --experimental-wasm-stack-switching flag.
    enableRunUntilComplete: false,
    // Explicit indexURL → deterministic asset resolution. Defaults to
    // node_modules/pyodide (works in plain Node AND transform pipelines like
    // Vitest); override to self-host from a vendored mirror.
    indexURL: options.indexURL ?? pyodideIndexPath(),
    packageCacheDir,
    stdout: options.stdout,
    stderr: options.stderr,
  });

  // Scientific stack first (lockfile packages; their `depends` resolve too),
  // THEN the pyicare wheel — pure-Python with no dependency resolution, which is
  // why its imports (numpy/pandas/scipy/patsy) must already be present. Both are
  // loaded from `indexURL` when set, so a complete mirror boots without network.
  // Wrapped in `withRetry` so a transient CDN drop on a cold boot self-heals
  // instead of surfacing as a hard `ModuleNotFoundError`.
  await withRetry(() => pyodide.loadPackage([...PYODIDE_DEFAULT_PACKAGES, ...(options.packages ?? [])]));
  await withRetry(() => pyodide.loadPackage(options.pyicareWheelUrl ?? pyicareWheelPath()));

  return createEngine(pyodide);
}

/** Filesystem directory for an `indexURL` (a `file://` URL or an absolute path), used as the package cache. */
function indexUrlToDir(indexURL: string): string {
  const path = indexURL.startsWith('file://') ? fileURLToPath(indexURL) : indexURL;
  return path.replace(/\/+$/, '');
}
