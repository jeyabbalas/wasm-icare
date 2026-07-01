/**
 * Engine — the env-neutral Pyodide + bridge lifecycle.
 *
 * Given an already-loaded Pyodide (supplied by the env-specific bootstrap),
 * `createEngine` defines the resident bridge module once and exposes health
 * queries plus a low-level operation call. It knows nothing about Node-vs-
 * browser asset acquisition; that lives in `bootstrap.node.ts` (and, in
 * Phase 7, the browser bootstrap).
 */

import type { PyodideInterface } from 'pyodide';

import type { Operation } from '../api/params';
import BRIDGE_SOURCE from '../bridge/bridge.py';
import {
  defineBridge,
  runBridge,
  type BridgeModule,
  type DataFrameProbe,
} from '../bridge/bridgeClient';
import { ICARE_BRIDGE_MODULE } from './config';

export interface Engine {
  /** Pyodide distribution version (e.g. '314.0.2'). */
  pyodideVersion(): string;
  /** Installed pyicare version — '1.2.0' proves the vendored wheel loaded. */
  icareVersion(): string;
  /** Versions of the Python runtime + the scientific stack. */
  runtimeVersions(): Record<string, string>;
  /** Probe the JS↔Python columnar round-trip (Phase 2 health check). */
  probeDataFrame(columns: Record<string, unknown>): DataFrameProbe;
  /** Low-level operation dispatch; the public ICARE handle wraps this in Phase 3. */
  run(
    op: Operation,
    kwargs: Record<string, unknown>,
    frames?: Record<string, unknown> | null,
  ): unknown;
  /** Release the resident bridge proxy and gate further calls. */
  close(): Promise<void>;
}

/**
 * Build an {@link Engine} over a loaded Pyodide. Defining the bridge runs
 * `import icare`, so the scientific stack + the pyicare wheel MUST already be
 * installed; the module proxy is held until `close()`.
 */
export function createEngine(pyodide: PyodideInterface): Engine {
  const bridge: BridgeModule = defineBridge(pyodide, BRIDGE_SOURCE, ICARE_BRIDGE_MODULE);
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error('ICARE engine is closed');
  };

  return {
    pyodideVersion: () => pyodide.version,
    icareVersion: () => {
      assertOpen();
      return bridge.pyicare_version();
    },
    runtimeVersions: () => {
      assertOpen();
      return runBridge.versions(bridge);
    },
    probeDataFrame: (columns) => {
      assertOpen();
      return runBridge.describeDataFrame(pyodide, bridge, columns);
    },
    run: (op, kwargs, frames = null) => {
      assertOpen();
      return runBridge.run(pyodide, bridge, op, kwargs, frames);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      bridge.destroy();
      // Pyodide has no in-process teardown in Node; real reclamation is process
      // exit (Node) or worker.terminate() (browser, Phase 7).
    },
  };
}
