/**
 * Transport — the async boundary the public API talks to.
 *
 * `EngineClient` is the async mirror of {@link Engine}: every data method returns
 * a `Promise`, so the facade / model handle / materializer are agnostic to WHERE
 * Pyodide runs. Three implementations decide that:
 *   - `createInProcessClient(engine)` — awaits the synchronous in-process engine
 *     (Node default; browser `useWorker:false`). Behaviour-identical to calling
 *     the engine directly, just Promise-wrapped.
 *   - `createWorkerClient(port, options)` — RPC over a Web Worker / worker_threads
 *     port; boots the remote engine on init (browser default + Node opt-in).
 *
 * `Engine` itself stays synchronous — it is what the worker host wraps. Because
 * every `Engine` method already returns a plain marshalled object (typed arrays +
 * small dicts), no `PyProxy` ever crosses this boundary.
 */

import type { Operation } from '../api/params';
import type { BuiltModel, DataFrameProbe } from '../bridge/bridgeClient';
import type { Engine } from '../runtime/engine';
import { ICAREError } from '../util/errors';
import { createCaller, INIT_METHOD, type PortAdapter } from './rpc';

/**
 * The async surface the public ICARE handle is built over — an async mirror of
 * {@link Engine}. Method names, argument order, and return shapes match the
 * engine exactly; only the sync/async wrapping differs.
 */
export interface EngineClient {
  pyodideVersion(): Promise<string>;
  icareVersion(): Promise<string>;
  runtimeVersions(): Promise<Record<string, string>>;
  probeDataFrame(columns: Record<string, unknown>): Promise<DataFrameProbe>;
  run(
    op: Operation,
    kwargs: Record<string, unknown>,
    frames?: Record<string, unknown> | null,
  ): Promise<unknown>;
  writeInputFile(name: string, bytes: Uint8Array): Promise<string>;
  buildModel(
    kwargs: Record<string, unknown>,
    frames?: Record<string, unknown> | null,
  ): Promise<BuiltModel>;
  applyModel(
    handle: number,
    kwargs: Record<string, unknown>,
    frames?: Record<string, unknown> | null,
  ): Promise<unknown>;
  freeModel(handle: number): Promise<void>;
  heapBytes(): Promise<number>;
  close(): Promise<void>;
}

/**
 * Wrap a synchronous in-process {@link Engine} as an {@link EngineClient}. Each
 * call is `async`, so a synchronous engine throw surfaces as a rejected Promise
 * (matching the worker path). No copying and no transport — the engine's plain
 * result objects are returned as-is.
 */
export function createInProcessClient(engine: Engine): EngineClient {
  return {
    async pyodideVersion() {
      return engine.pyodideVersion();
    },
    async icareVersion() {
      return engine.icareVersion();
    },
    async runtimeVersions() {
      return engine.runtimeVersions();
    },
    async probeDataFrame(columns) {
      return engine.probeDataFrame(columns);
    },
    async run(op, kwargs, frames = null) {
      return engine.run(op, kwargs, frames);
    },
    async writeInputFile(name, bytes) {
      return engine.writeInputFile(name, bytes);
    },
    async buildModel(kwargs, frames = null) {
      return engine.buildModel(kwargs, frames);
    },
    async applyModel(handle, kwargs, frames = null) {
      return engine.applyModel(handle, kwargs, frames);
    },
    async freeModel(handle) {
      engine.freeModel(handle);
    },
    async heapBytes() {
      return engine.heapBytes();
    },
    close() {
      return engine.close();
    },
  };
}

/**
 * Wrap a worker {@link PortAdapter} as an {@link EngineClient} over the RPC in
 * `rpc.ts`. Sends the init request (booting the remote engine with `options`) and
 * resolves once the worker is ready; every method is then a request/response
 * round-trip. Inputs are structure-cloned across the boundary (never transferred —
 * batch frames may be `subarray` views); outputs are transferred by the host.
 * `close` releases the remote engine, then terminates the worker and rejects any
 * in-flight calls.
 */
export async function createWorkerClient(
  port: PortAdapter,
  options: unknown,
): Promise<EngineClient> {
  const caller = createCaller(port);
  await caller.call(INIT_METHOD, [options]);

  return {
    pyodideVersion: () => caller.call('pyodideVersion', []) as Promise<string>,
    icareVersion: () => caller.call('icareVersion', []) as Promise<string>,
    runtimeVersions: () => caller.call('runtimeVersions', []) as Promise<Record<string, string>>,
    probeDataFrame: (columns) => caller.call('probeDataFrame', [columns]) as Promise<DataFrameProbe>,
    run: (op, kwargs, frames = null) => caller.call('run', [op, kwargs, frames]),
    writeInputFile: (name, bytes) => caller.call('writeInputFile', [name, bytes]) as Promise<string>,
    buildModel: (kwargs, frames = null) =>
      caller.call('buildModel', [kwargs, frames]) as Promise<BuiltModel>,
    applyModel: (handle, kwargs, frames = null) => caller.call('applyModel', [handle, kwargs, frames]),
    freeModel: async (handle) => {
      await caller.call('freeModel', [handle]);
    },
    heapBytes: () => caller.call('heapBytes', []) as Promise<number>,
    close: async () => {
      try {
        await caller.call('close', []);
      } finally {
        port.terminate();
        caller.rejectAll(new ICAREError('ICARE engine client was closed'));
      }
    },
  };
}
