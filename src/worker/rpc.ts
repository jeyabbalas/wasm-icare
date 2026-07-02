/**
 * RPC — pure transport, no iCARE semantics.
 *
 * A minimal id-routed request/response protocol shared by the browser Web Worker
 * and the Node `worker_threads` worker:
 *   - {@link PortAdapter} normalizes the two message-port dialects (browser
 *     `addEventListener('message', e => …e.data)` + `postMessage(msg, transfer)`
 *     vs Node `.on('message', value)` + `postMessage(value, transferList)`).
 *   - {@link collectTransferables} lists the ArrayBuffers to move zero-copy —
 *     used for OUTBOUND results only (fresh, fully-owned buffers). Inbound frames
 *     are structure-cloned because batch columns may be `subarray` views.
 *   - {@link serializeError} / {@link deserializeError} round-trip the SDK error
 *     taxonomy so `catch (e instanceof HeapExhaustedError)` still works remotely.
 *   - {@link createCaller} is the client side: send a request, await its response.
 */

import { HeapExhaustedError, ICAREError, ICAREPythonError } from '../util/errors';

/** A method call: `id` routes the response; `method`/`args` mirror the EngineClient call. */
export interface RpcRequest {
  id: number;
  method: string;
  args: unknown[];
}

/** A response, keyed to its request `id`. */
export type RpcResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: SerializedError };

/** The reserved "init" method name — carries bootstrap options, boots the engine. */
export const INIT_METHOD = '__init__';

// --- Port abstraction --------------------------------------------------------

/** A `Worker` / `MessagePort` / `DedicatedWorkerGlobalScope` (browser dialect). */
export interface BrowserPortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  terminate?(): void;
  close?(): void;
  start?(): void;
}

/** A `worker_threads` `Worker` / `MessagePort` (Node dialect). */
export interface NodePortLike {
  postMessage(value: unknown, transferList?: readonly unknown[]): void;
  on(event: 'message', listener: (value: unknown) => void): void;
  terminate?(): unknown;
  close?(): void;
}

/** One end of a message channel, dialect-normalized. */
export interface PortAdapter {
  post(message: unknown, transfer?: Transferable[]): void;
  onMessage(handler: (data: unknown) => void): void;
  terminate(): void;
}

/** Adapt a browser `Worker` / `MessagePort` / worker `self`. */
export function browserPort(target: BrowserPortLike): PortAdapter {
  return {
    post: (message, transfer) => target.postMessage(message, transfer),
    onMessage: (handler) => {
      target.addEventListener('message', (event) => handler(event.data));
      target.start?.();
    },
    terminate: () => (target.terminate ? target.terminate() : target.close?.()),
  };
}

/** Adapt a Node `worker_threads` `Worker` / `MessagePort`. */
export function nodePort(target: NodePortLike): PortAdapter {
  return {
    post: (message, transfer) => target.postMessage(message, transfer as readonly unknown[] | undefined),
    onMessage: (handler) => target.on('message', (value) => handler(value)),
    terminate: () => {
      if (target.terminate) target.terminate();
      else target.close?.();
    },
  };
}

// --- Transferables -----------------------------------------------------------

/**
 * Collect the backing `ArrayBuffer`s of every TypedArray reachable in `value`,
 * deduplicated. Our marshalled results carry only fresh, fully-owned float64 /
 * int32 buffers, so listing them as `postMessage` transferables moves them
 * zero-copy (and detaches the sender's copy). SharedArrayBuffers are skipped
 * (not transferable); plain `number[]` / `string[]` are walked but contribute
 * nothing.
 */
export function collectTransferables(value: unknown): Transferable[] {
  const out = new Set<ArrayBuffer>();
  walk(value, out);
  return [...out];
}

function walk(value: unknown, out: Set<ArrayBuffer>): void {
  if (value == null || typeof value !== 'object') return;
  if (ArrayBuffer.isView(value)) {
    const { buffer } = value as ArrayBufferView;
    if (buffer instanceof ArrayBuffer) out.add(buffer);
    return;
  }
  if (value instanceof ArrayBuffer) {
    out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, out);
    return;
  }
  for (const key of Object.keys(value)) walk((value as Record<string, unknown>)[key], out);
}

// --- Error serialization -----------------------------------------------------

/** A wire-safe error: the class discriminant + message (+ Python traceback). */
export interface SerializedError {
  name: string;
  message: string;
  code: 'heap' | 'python' | 'base';
  pythonTraceback?: string;
}

/** Flatten an error (already mapped via `wrapPythonError` on the host) for the wire. */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof HeapExhaustedError) {
    return { name: error.name, message: error.message, code: 'heap' };
  }
  if (error instanceof ICAREPythonError) {
    return {
      name: error.name,
      message: error.message,
      code: 'python',
      pythonTraceback: error.pythonTraceback,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, code: 'base' };
  }
  return { name: 'Error', message: String(error), code: 'base' };
}

/** Rebuild the right SDK error class on the client side. */
export function deserializeError(serialized: SerializedError): ICAREError {
  let error: ICAREError;
  switch (serialized.code) {
    case 'heap':
      error = new HeapExhaustedError(serialized.message);
      break;
    case 'python':
      error = new ICAREPythonError(serialized.message, serialized.pythonTraceback);
      break;
    default:
      error = new ICAREError(serialized.message);
  }
  error.name = serialized.name;
  return error;
}

// --- Client caller -----------------------------------------------------------

/** The client side of the RPC: send a request, await its response. */
export interface RpcCaller {
  call(method: string, args: unknown[], transfer?: Transferable[]): Promise<unknown>;
  /** Reject every in-flight call (on client close / worker death). */
  rejectAll(reason: Error): void;
}

/** Build a caller over a port: routes responses back to their pending promise by `id`. */
export function createCaller(port: PortAdapter): RpcCaller {
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let nextId = 1;

  port.onMessage((data) => {
    if (data == null || typeof data !== 'object') return;
    const response = data as RpcResponse;
    if (typeof response.id !== 'number') return; // not a response envelope
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) entry.resolve(response.value);
    else entry.reject(deserializeError(response.error));
  });

  return {
    call(method, args, transfer) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: RpcRequest = { id, method, args };
        port.post(request, transfer);
      });
    },
    rejectAll(reason) {
      for (const { reject } of pending.values()) reject(reason);
      pending.clear();
    },
  };
}
