/// <reference types="node" />
/**
 * Node `worker_threads` client — spawns `nodeWorker.ts` and drives it over RPC.
 *
 * Node-only (imports `node:worker_threads`); reached solely from `index.node.ts`,
 * so it never enters the neutral/browser bundles. The default worker URL resolves
 * to the built `dist/nodeWorker.js` sibling; tests pass `workerUrl` explicitly.
 */

import { Worker } from 'node:worker_threads';

import type { LoadICAREOptions } from '../api/types';
import { nodePort } from './rpc';
import { createWorkerClient, type EngineClient } from './transport';

/** Options the Node worker forwards to `bootstrapNodeEngine` over the init RPC. */
interface NodeWorkerBootstrap {
  packages?: readonly string[];
}

/** Spawn the Node worker thread and return an {@link EngineClient} driving it. */
export async function createNodeWorkerClient(options: LoadICAREOptions): Promise<EngineClient> {
  const workerUrl = options.workerUrl ?? new URL('./nodeWorker.js', import.meta.url);
  const worker = new Worker(workerUrl);

  const bootstrap: NodeWorkerBootstrap = {};
  if (options.packages !== undefined) bootstrap.packages = options.packages;

  return createWorkerClient(nodePort(worker), bootstrap);
}
