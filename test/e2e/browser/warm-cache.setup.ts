import { resolve } from 'node:path';
import process from 'node:process';

import { loadPyodide } from 'pyodide';

import { pyodideIndexPath } from '../../../src/runtime/assets-node';
import { PYODIDE_DEFAULT_PACKAGES } from '../../../src/runtime/config';

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
  await pyodide.loadPackage([...PYODIDE_DEFAULT_PACKAGES]);
}
