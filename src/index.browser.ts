/**
 * Browser entry. Re-exports the shared surface and wires the real `loadICARE`
 * (overriding the throwing stub from `./index`): a module Web Worker by default
 * (`useWorker:true`, keeping Pyodide off the main thread), or the engine in-process
 * when `useWorker:false`. Pyodide assets come from the pinned CDN by default;
 * override with `indexURL` / `pyicareWheelUrl` to self-host.
 *
 * This is the only entry that pulls in the worker + browser-bootstrap modules; the
 * Node built-ins stay behind `index.node.ts`.
 */
export * from './index';

import { createICARE } from './api/icareFacade';
import type { ICARE, LoadICAREOptions } from './api/types';
import { createBrowserMaterializer } from './io/materialize-browser';
import {
  bootstrapBrowserEngine,
  type BrowserBootstrapOptions,
} from './runtime/bootstrap-browser';
import { browserPort } from './worker/rpc';
import { createInProcessClient, createWorkerClient, type EngineClient } from './worker/transport';

/**
 * Boot Pyodide with the vendored pyicare wheel and return the ICARE handle. In the
 * browser the engine runs in a module Worker by default; `useWorker:false` runs it
 * on the calling thread (e.g. inside a Worker already). `close()` releases the
 * runtime and terminates the worker.
 */
export async function loadICARE(options: LoadICAREOptions = {}): Promise<ICARE> {
  const useWorker = options.useWorker ?? true;
  const client = useWorker
    ? await spawnWorkerClient(options)
    : createInProcessClient(await bootstrapBrowserEngine(bootstrapOptions(options)));
  return createICARE(client, createBrowserMaterializer(client));
}

/** Spawn the module worker and hand it the bootstrap options over the init RPC. */
async function spawnWorkerClient(options: LoadICAREOptions): Promise<EngineClient> {
  const workerUrl = options.workerUrl ?? new URL('./worker.js', import.meta.url);
  const worker = new Worker(workerUrl, { type: 'module' });
  return createWorkerClient(browserPort(worker), bootstrapOptions(options));
}

/** Project the loader options onto the browser bootstrap subset. */
function bootstrapOptions(options: LoadICAREOptions): BrowserBootstrapOptions {
  const bootstrap: BrowserBootstrapOptions = {};
  if (options.indexURL !== undefined) bootstrap.indexURL = options.indexURL;
  if (options.pyicareWheelUrl !== undefined) bootstrap.pyicareWheelUrl = options.pyicareWheelUrl;
  if (options.offline !== undefined) bootstrap.offline = options.offline;
  if (options.packages !== undefined) bootstrap.packages = options.packages;
  return bootstrap;
}
