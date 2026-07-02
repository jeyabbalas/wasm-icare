import { describe, expect, test, vi } from 'vitest';

import type { Engine } from '../../src/runtime/engine';
import { createInProcessClient } from '../../src/worker/transport';

/** A synchronous fake Engine that records calls and can be told to throw. */
function makeEngine(overrides: Partial<Engine> = {}) {
  const engine = {
    pyodideVersion: () => '314.0.2',
    icareVersion: () => '1.3.0',
    runtimeVersions: () => ({ icare: '1.3.0' }),
    probeDataFrame: (columns: Record<string, unknown>) => ({
      columns: Object.keys(columns),
      n_rows: 0,
      column_sums: {},
    }),
    run: vi.fn((op: string, kwargs: Record<string, unknown>, frames?: unknown) => ({
      op,
      kwargs,
      frames: frames ?? null,
    })),
    writeInputFile: vi.fn((name: string) => `/input/${name}`),
    buildModel: vi.fn(() => ({ handle: 3, model: { x: 0.5 } })),
    applyModel: vi.fn((handle: number) => ({ handle })),
    freeModel: vi.fn(() => {}),
    heapBytes: () => 16_777_216,
    close: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Engine;
  return engine;
}

describe('createInProcessClient — async wrapper over a sync engine', () => {
  test('forwards each method to the engine and resolves its return value', async () => {
    const engine = makeEngine();
    const client = createInProcessClient(engine);

    expect(await client.pyodideVersion()).toBe('314.0.2');
    expect(await client.icareVersion()).toBe('1.3.0');
    expect(await client.runtimeVersions()).toEqual({ icare: '1.3.0' });
    expect(await client.probeDataFrame({ a: [1] })).toEqual({
      columns: ['a'],
      n_rows: 0,
      column_sums: {},
    });
    expect(await client.run('compute', { k: 1 }, { f: 2 })).toEqual({
      op: 'compute',
      kwargs: { k: 1 },
      frames: { f: 2 },
    });
    expect(await client.writeInputFile('ref.csv', new Uint8Array([1, 2]))).toBe('/input/ref.csv');
    expect(await client.buildModel({ k: 1 }, null)).toEqual({ handle: 3, model: { x: 0.5 } });
    expect(await client.applyModel(3, { k: 1 }, null)).toEqual({ handle: 3 });
    expect(await client.heapBytes()).toBe(16_777_216);
    await client.freeModel(3);
    await client.close();
    expect(engine.close).toHaveBeenCalledOnce();
  });

  test('defaults omitted frames to null on run / buildModel / applyModel', async () => {
    const engine = makeEngine();
    const client = createInProcessClient(engine);

    await client.run('compute', { k: 1 });
    await client.buildModel({ k: 1 });
    await client.applyModel(3, { k: 1 });

    expect(engine.run).toHaveBeenCalledWith('compute', { k: 1 }, null);
    expect(engine.buildModel).toHaveBeenCalledWith({ k: 1 }, null);
    expect(engine.applyModel).toHaveBeenCalledWith(3, { k: 1 }, null);
  });

  test('a synchronous engine throw surfaces as a rejected Promise', async () => {
    const engine = makeEngine({
      run: () => {
        throw new Error('boom');
      },
    });
    const client = createInProcessClient(engine);

    await expect(client.run('compute', {})).rejects.toThrow('boom');
  });
});
