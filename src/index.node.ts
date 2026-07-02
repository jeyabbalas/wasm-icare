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
import { createNodeWorkerClient } from './worker/nodeWorkerClient';
import { createInProcessClient, type EngineClient } from './worker/transport';

/**
 * Boot Pyodide with the vendored pyicare wheel and return the ICARE handle. In
 * Node this is the "vendored snapshot" path: the runtime + scientific stack come
 * from `node_modules/pyodide`, the pyicare wheel from `assets/`. The engine runs
 * in-process by default; `useWorker:true` opts into a `worker_threads` worker
 * (built `dist/nodeWorker.js`). Only `options.packages` is honored today (indexURL
 * / offline arrive in Phase 8).
 */
export async function loadICARE(options: LoadICAREOptions = {}): Promise<ICARE> {
  const client = options.useWorker
    ? await createNodeWorkerClient(options)
    : await bootstrapInProcessClient(options);
  return createICARE(client, createNodeMaterializer(client));
}

/** Boot the in-process engine and wrap it as a client (the Node default path). */
async function bootstrapInProcessClient(options: LoadICAREOptions): Promise<EngineClient> {
  const engine = await bootstrapNodeEngine(
    options.packages ? { packages: options.packages } : {},
  );
  return createInProcessClient(engine);
}
