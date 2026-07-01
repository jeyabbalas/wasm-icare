/**
 * Node.js entry. Re-exports the shared surface and wires the Node runtime
 * bootstrap. This is the only published entry that pulls in `pyodide` +
 * `node:*` (bundled into `dist/index.node.js`); the neutral (`index.ts`) and
 * browser (`index.browser.ts`) entries never import it.
 *
 * The real `loadICARE` below overrides the throwing stub re-exported from
 * `./index`; `bootstrapNodeEngine` remains the internal factory used by the
 * engine smoke test.
 */
export * from './index';
export { bootstrapNodeEngine, type NodeBootstrapOptions } from './runtime/bootstrap-node';
export type { Engine } from './runtime/engine';

import { createICARE } from './api/icareFacade';
import type { ICARE, LoadICAREOptions } from './api/types';
import { createNodeMaterializer } from './io/materialize-node';
import { bootstrapNodeEngine } from './runtime/bootstrap-node';

/**
 * Boot Pyodide with the vendored pyicare wheel and return the ICARE handle. In
 * Node this is the "vendored snapshot" path: the runtime + scientific stack come
 * from `node_modules/pyodide`, the pyicare wheel from `assets/`. Only
 * `options.packages` is honored in Phase 3 (worker / indexURL / offline arrive
 * in Phases 7–8).
 */
export async function loadICARE(options: LoadICAREOptions = {}): Promise<ICARE> {
  const engine = await bootstrapNodeEngine(
    options.packages ? { packages: options.packages } : {},
  );
  const materialize = createNodeMaterializer(engine);
  return createICARE(engine, materialize);
}
