/**
 * wasm-icare — shared public surface (environment-neutral).
 *
 * `index.node.ts` and `index.browser.ts` re-export this and, in later phases,
 * wire the environment-specific Pyodide bootstrap into `loadICARE`.
 */

export * from './api/types';
export * from './api/params';
export {
  PYODIDE_VERSION,
  PYICARE_VERSION,
  PYICARE_WHEEL_FILENAME,
  PYICARE_WHEEL_PATH,
  PYODIDE_DEFAULT_PACKAGES,
  PYODIDE_CDN_BASE_URL,
  ICARE_BRIDGE_MODULE,
} from './runtime/config';

import type { ICARE, LoadICAREOptions } from './api/types';

/**
 * Boot Pyodide, load the vendored pyicare wheel, and return a handle exposing
 * `computeAbsoluteRisk`, `computeAbsoluteRiskSplitInterval`, and
 * `validateAbsoluteRiskModel`.
 *
 * The runtime bridge lands in Phase 2/3; the signature is declared now so the
 * public API and its types resolve for consumers and the build.
 */
export async function loadICARE(_options?: LoadICAREOptions): Promise<ICARE> {
  throw new Error(
    'loadICARE is not implemented yet — the Pyodide runtime bridge lands in Phase 2/3.',
  );
}
