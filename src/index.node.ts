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
import { bootstrapNodeEngine, type NodeBootstrapOptions } from './runtime/bootstrap-node';
import { createNodeWorkerClient } from './worker/nodeWorkerClient';
import { createInProcessClient, type EngineClient } from './worker/transport';

/**
 * Boot Pyodide with the vendored pyicare wheel and return the ICARE handle. In
 * Node this is the "vendored snapshot" path: by default the runtime comes from
 * `node_modules/pyodide` and the pyicare wheel from `assets/` (the scientific
 * wheels download+cache on first boot). Pass `indexURL`/`pyicareWheelUrl` — e.g. a
 * mirror from `npx wasm-icare-vendor <dir>` — with `offline:true` to boot without
 * any network. The engine runs in-process by default; `useWorker:true` opts into a
 * `worker_threads` worker (built `dist/nodeWorker.js`).
 */
export async function loadICARE(options: LoadICAREOptions = {}): Promise<ICARE> {
  const client = options.useWorker
    ? await createNodeWorkerClient(options)
    : await bootstrapInProcessClient(options);
  return createICARE(client, createNodeMaterializer(client));
}

/** Boot the in-process engine and wrap it as a client (the Node default path). */
async function bootstrapInProcessClient(options: LoadICAREOptions): Promise<EngineClient> {
  const engine = await bootstrapNodeEngine(nodeBootstrapOptions(options));
  return createInProcessClient(engine);
}

/**
 * Project the loader options onto the Node bootstrap subset — the counterpart to
 * the browser's `bootstrapOptions`. Only defined keys are copied so an omitted arg
 * falls through to pyicare's own default (and stays serializable for the worker
 * init RPC).
 */
export function nodeBootstrapOptions(options: LoadICAREOptions): NodeBootstrapOptions {
  const bootstrap: NodeBootstrapOptions = {};
  if (options.indexURL !== undefined) bootstrap.indexURL = options.indexURL;
  if (options.pyicareWheelUrl !== undefined) bootstrap.pyicareWheelUrl = options.pyicareWheelUrl;
  if (options.offline !== undefined) bootstrap.offline = options.offline;
  if (options.packages !== undefined) bootstrap.packages = options.packages;
  return bootstrap;
}
