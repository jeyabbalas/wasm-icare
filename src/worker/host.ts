/**
 * Worker host — the engine side of the RPC, shared by the browser Web Worker and
 * the Node `worker_threads` entry.
 *
 * `serveEngine(port, bootstrap)` owns the port's message loop: the first
 * {@link INIT_METHOD} request boots the engine (via the env-specific `bootstrap`);
 * every later request is dispatched to the resident, SYNCHRONOUS {@link Engine}
 * and its plain result posted back with the output buffers listed as
 * transferables. Errors are mapped through `wrapPythonError` and serialized so the
 * client re-throws the right SDK error class. The host never self-terminates — the
 * client calls `close` then terminates the worker.
 */

import type { Operation } from '../api/params';
import type { Engine } from '../runtime/engine';
import { ICAREError, wrapPythonError } from '../util/errors';
import {
  collectTransferables,
  INIT_METHOD,
  serializeError,
  type PortAdapter,
  type RpcRequest,
  type RpcResponse,
} from './rpc';

/** Boot an {@link Engine} from the opaque options carried by the init request. */
export type EngineBootstrap = (options: unknown) => Promise<Engine>;

/** Attach the RPC server loop to `port`, booting the engine lazily on init. */
export function serveEngine(port: PortAdapter, bootstrap: EngineBootstrap): void {
  let engine: Engine | undefined;

  port.onMessage((data) => {
    void handle(data);
  });

  async function handle(data: unknown): Promise<void> {
    if (data == null || typeof data !== 'object') return;
    const request = data as RpcRequest;
    if (typeof request.id !== 'number' || typeof request.method !== 'string') return;

    if (request.method === INIT_METHOD) {
      try {
        engine = await bootstrap(request.args[0]);
        reply({ id: request.id, ok: true, value: { ready: true } });
      } catch (error) {
        reply({
          id: request.id,
          ok: false,
          error: serializeError(wrapPythonError('worker engine bootstrap failed', error)),
        });
      }
      return;
    }

    if (!engine) {
      reply({
        id: request.id,
        ok: false,
        error: serializeError(new ICAREError('worker engine is not initialized')),
      });
      return;
    }

    try {
      const value = await invokeEngine(engine, request.method, request.args);
      reply({ id: request.id, ok: true, value }, collectTransferables(value));
    } catch (error) {
      reply({
        id: request.id,
        ok: false,
        error: serializeError(wrapPythonError(`engine.${request.method} failed`, error)),
      });
    }
  }

  function reply(response: RpcResponse, transfer?: Transferable[]): void {
    port.post(response, transfer);
  }
}

/**
 * Dispatch one request onto the synchronous engine. Only `close` is async; every
 * other method returns synchronously (its plain result crosses the wire as-is).
 */
async function invokeEngine(engine: Engine, method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'pyodideVersion':
      return engine.pyodideVersion();
    case 'icareVersion':
      return engine.icareVersion();
    case 'runtimeVersions':
      return engine.runtimeVersions();
    case 'probeDataFrame':
      return engine.probeDataFrame(args[0] as Record<string, unknown>);
    case 'run':
      return engine.run(
        args[0] as Operation,
        args[1] as Record<string, unknown>,
        (args[2] ?? null) as Record<string, unknown> | null,
      );
    case 'writeInputFile':
      return engine.writeInputFile(args[0] as string, args[1] as Uint8Array);
    case 'buildModel':
      return engine.buildModel(
        args[0] as Record<string, unknown>,
        (args[1] ?? null) as Record<string, unknown> | null,
      );
    case 'applyModel':
      return engine.applyModel(
        args[0] as number,
        args[1] as Record<string, unknown>,
        (args[2] ?? null) as Record<string, unknown> | null,
      );
    case 'freeModel':
      engine.freeModel(args[0] as number);
      return undefined;
    case 'heapBytes':
      return engine.heapBytes();
    case 'close':
      await engine.close();
      return undefined;
    default:
      throw new ICAREError(`unknown engine method: ${method}`);
  }
}
