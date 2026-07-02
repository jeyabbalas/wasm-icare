/**
 * Browser module-worker entry (built to `dist/worker.js`).
 *
 * Hosts the engine off the main thread: on the init request it boots Pyodide via
 * the browser bootstrap, then serves every EngineClient call over the port. This
 * is the file `new Worker(url, { type: 'module' })` loads — spawned by
 * `loadICARE` in the browser default (`useWorker:true`).
 */

import { bootstrapBrowserEngine, type BrowserBootstrapOptions } from '../runtime/bootstrap-browser';
import { serveEngine } from './host';
import { browserPort, type BrowserPortLike } from './rpc';

// `self` is the DedicatedWorkerGlobalScope; it satisfies the browser port dialect
// (postMessage + addEventListener; `close()` for teardown).
serveEngine(browserPort(self as unknown as BrowserPortLike), (options) =>
  bootstrapBrowserEngine((options ?? {}) as BrowserBootstrapOptions),
);
