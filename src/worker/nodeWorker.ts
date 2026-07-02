/// <reference types="node" />
/**
 * Node `worker_threads` entry (built to `dist/nodeWorker.js`).
 *
 * The opt-in `useWorker:true` path in the Node `loadICARE` spawns this to host the
 * engine off the main thread. It boots Pyodide via the Node bootstrap on the init
 * request, then serves every EngineClient call over `parentPort` — the same host
 * loop the browser worker uses, only the port dialect differs.
 */

import { parentPort } from 'node:worker_threads';

import { bootstrapNodeEngine, type NodeBootstrapOptions } from '../runtime/bootstrap-node';
import { ICAREError } from '../util/errors';
import { serveEngine } from './host';
import { nodePort } from './rpc';

if (!parentPort) {
  throw new ICAREError('nodeWorker.ts must run inside a worker_threads Worker');
}

serveEngine(nodePort(parentPort), (options) =>
  bootstrapNodeEngine({
    ...((options ?? {}) as NodeBootstrapOptions),
    // A worker thread's `process.stdout`/`stderr` have no fd, so Pyodide's default
    // `fs.writeSync(fd, …)` writer throws. Route its output through `console`
    // (piped to the parent) instead.
    stdout: (message: string) => console.log(message),
    stderr: (message: string) => console.error(message),
  }),
);
