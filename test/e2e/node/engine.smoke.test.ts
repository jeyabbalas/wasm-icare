/**
 * Phase 2 engine smoke test — the first real Pyodide boot.
 *
 * Boots the Node engine ONCE (beforeAll), then asserts the runtime + bridge
 * layer is healthy: the vendored pyicare wheel installed offline, the
 * scientific stack imports at the pinned versions, and a JS↔Python columnar
 * round-trip survives `toPy`/`build_df`/`toJs`. Runs under the `e2e` project
 * (serialized, 300s hook timeout). The first run fetches numpy/pandas/scipy/
 * patsy from JsDelivr and caches them to `.pyodide-cache`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  bootstrapNodeEngine,
  PYICARE_VERSION,
  PYODIDE_VERSION,
  type Engine,
} from '../../../src/index.node';

let engine: Engine;

beforeAll(async () => {
  engine = await bootstrapNodeEngine();
});

afterAll(async () => {
  await engine?.close();
});

describe('engine smoke (Node runtime + Python bridge)', () => {
  test('boots Pyodide and reports the pinned distribution version', () => {
    expect(engine.pyodideVersion()).toBe(PYODIDE_VERSION);
  });

  test('installs the vendored pyicare wheel offline', () => {
    expect(engine.icareVersion()).toBe(PYICARE_VERSION);
  });

  test('scientific stack imports; versions satisfy the pins', () => {
    const versions = engine.runtimeVersions();
    expect(versions).toMatchObject({
      icare: '1.3.0',
      numpy: '2.4.3',
      pandas: '3.0.2',
      scipy: '1.18.0',
      patsy: '1.0.2',
    });
    expect(versions.python?.startsWith('3.14')).toBe(true);
  });

  test('JS → Python → JS round-trip through the bridge (toPy + build_df + toJs)', () => {
    const probe = engine.probeDataFrame({ a: [1, 2, 3], b: [4.5, 5.5, 6.5] });
    expect(probe.columns).toEqual(['a', 'b']);
    expect(probe.n_rows).toBe(3);
    expect(probe.column_sums.a).toBeCloseTo(6);
    expect(probe.column_sums.b).toBeCloseTo(16.5);
  });

  // Order-dependent by design: runs last and closes the shared engine.
  // `afterAll`'s `close()` is idempotent, so the double-close is harmless.
  test('close() releases the engine and gates further calls', async () => {
    await engine.close();
    expect(() => engine.icareVersion()).toThrow(/closed/);
  });
});
