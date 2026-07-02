import { MessageChannel } from 'node:worker_threads';

import { describe, expect, test } from 'vitest';

import { HeapExhaustedError, ICAREError, ICAREPythonError } from '../../src/util/errors';
import {
  collectTransferables,
  createCaller,
  deserializeError,
  nodePort,
  serializeError,
  type PortAdapter,
  type RpcRequest,
} from '../../src/worker/rpc';

/** A controllable in-memory port: capture what's posted, inject what's received. */
function fakePort() {
  let handler: ((data: unknown) => void) | undefined;
  const posted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  const adapter: PortAdapter = {
    post: (message, transfer) => posted.push({ message, transfer }),
    onMessage: (h) => {
      handler = h;
    },
    terminate: () => {},
  };
  return {
    adapter,
    posted,
    deliver: (data: unknown) => handler?.(data),
  };
}

describe('collectTransferables', () => {
  test('collects TypedArray buffers from a nested result, dedupes, ignores number[]/string[]', () => {
    const risks = new Float64Array([0.1, 0.2]);
    const codes = new Int32Array([0, 1, 0]);
    const result = {
      profile: {
        columns: {
          risk_estimates: risks,
          linear_predictors_category: codes,
          id: ['a', 'b'], // string[] — not transferable
          age: [50, 51], // number[] — not transferable
        },
      },
      reference_risks: [{ population_risks: risks }], // same buffer again → deduped
      method: 'iCARE',
    };

    const transfer = collectTransferables(result);
    expect(transfer).toHaveLength(2);
    expect(transfer).toContain(risks.buffer);
    expect(transfer).toContain(codes.buffer);
  });

  test('returns an empty list for buffer-free values', () => {
    expect(collectTransferables({ a: 1, b: 'x', c: [1, 2, 3] })).toEqual([]);
    expect(collectTransferables(null)).toEqual([]);
  });
});

describe('error serialization round-trip', () => {
  test('HeapExhaustedError survives as HeapExhaustedError', () => {
    const restored = deserializeError(serializeError(new HeapExhaustedError('heap gone')));
    expect(restored).toBeInstanceOf(HeapExhaustedError);
    expect(restored.message).toBe('heap gone');
  });

  test('ICAREPythonError preserves its traceback', () => {
    const restored = deserializeError(
      serializeError(new ICAREPythonError('compute failed', 'Traceback ... ValueError')),
    );
    expect(restored).toBeInstanceOf(ICAREPythonError);
    expect((restored as ICAREPythonError).pythonTraceback).toBe('Traceback ... ValueError');
  });

  test('a generic Error degrades to ICAREError with its name preserved', () => {
    const restored = deserializeError(serializeError(new TypeError('bad arg')));
    expect(restored).toBeInstanceOf(ICAREError);
    expect(restored.name).toBe('TypeError');
    expect(restored.message).toBe('bad arg');
  });
});

describe('createCaller — id-routed request/response', () => {
  test('posts a well-formed request and resolves on the matching ok response', async () => {
    const port = fakePort();
    const caller = createCaller(port.adapter);

    const pending = caller.call('run', ['compute', { k: 1 }]);
    expect(port.posted).toHaveLength(1);
    const request = port.posted[0]!.message as RpcRequest;
    expect(request).toMatchObject({ id: 1, method: 'run', args: ['compute', { k: 1 }] });

    port.deliver({ id: request.id, ok: true, value: 42 });
    expect(await pending).toBe(42);
  });

  test('rejects with the deserialized error class on an error response', async () => {
    const port = fakePort();
    const caller = createCaller(port.adapter);

    const pending = caller.call('run', []);
    const { id } = port.posted[0]!.message as RpcRequest;
    port.deliver({ id, ok: false, error: { name: 'HeapExhaustedError', message: 'oom', code: 'heap' } });

    await expect(pending).rejects.toBeInstanceOf(HeapExhaustedError);
  });

  test('rejectAll rejects every in-flight call', async () => {
    const port = fakePort();
    const caller = createCaller(port.adapter);
    const pending = caller.call('run', []);
    caller.rejectAll(new ICAREError('closed'));
    await expect(pending).rejects.toThrow('closed');
  });
});

describe('transfer semantics over a real MessageChannel', () => {
  test('posting with collectTransferables detaches the source buffer', async () => {
    const channel = new MessageChannel();
    const sender = nodePort(channel.port1);
    const receiver = nodePort(channel.port2);
    try {
      const received = new Promise<{ payload: Float64Array }>((resolve) => {
        receiver.onMessage((data) => resolve(data as { payload: Float64Array }));
      });
      const arr = new Float64Array([1, 2, 3]);
      sender.post({ payload: arr }, collectTransferables(arr));

      const got = await received;
      expect(Array.from(got.payload)).toEqual([1, 2, 3]);
      // The sender's buffer was moved, not copied: it is now detached.
      expect(arr.byteLength).toBe(0);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });
});
