import { resolve } from 'node:path';
import process from 'node:process';

import { loadPyodide } from 'pyodide';

import { pyodideIndexPath } from '../../../src/runtime/assets-node';
import { PYODIDE_DEFAULT_PACKAGES } from '../../../src/runtime/config';
import { withRetry } from '../../../src/util/retry';

/**
 * Extra Pyodide packages the E2E suites boot with beyond {@link PYODIDE_DEFAULT_PACKAGES}.
 * `pyarrow` is the Arrow-input path's Python-side dependency (not a pyicare runtime
 * dep, so it is intentionally absent from the default set). Warming it here means the
 * Arrow test's `loadICARE({ packages: ['pyarrow'] })` is a local cache hit — no live
 * jsDelivr fetch at `beforeAll`, which was the nightly `ModuleNotFoundError` flake.
 */
const E2E_EXTRA_PACKAGES = ['pyarrow'] as const;

/**
 * Browser-project global setup (runs in Node). Downloads the scientific stack into
 * `.pyodide-cache` if it is not already there, so the `/pyodide/` asset mirror the
 * browser self-hosts from has every wheel — making the Playwright run offline and
 * deterministic. Intentionally does NOT import the bridge (no `.py` transform
 * needed here): warming the cache only needs loadPyodide + loadPackage.
 */
export default async function setup(): Promise<void> {
  const pyodide = await loadPyodide({
    indexURL: pyodideIndexPath(),
    enableRunUntilComplete: false,
    packageCacheDir: resolve(process.cwd(), '.pyodide-cache'),
  });
  // Retried: on a cold cache these come from jsDelivr, so a transient drop here
  // would otherwise fail every downstream E2E test.
  await withRetry(() => pyodide.loadPackage([...PYODIDE_DEFAULT_PACKAGES, ...E2E_EXTRA_PACKAGES]));
}
