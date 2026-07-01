/**
 * Bridge client — the ONLY place JS speaks Python.
 *
 * Owns three concerns for the resident `bridge.py` module:
 *  1. defining it once in the Pyodide runtime (`defineBridge`);
 *  2. `toPy` marshalling of JS option/columnar objects into Python; and
 *  3. PyProxy lifetime discipline — every transient proxy created here is
 *     `.destroy()`ed in a `finally`, so nothing leaks into the WASM heap.
 *
 * Env-neutral: imports only `pyodide` TYPES + the params/output/errors modules.
 * Results flow through `bridge.columnarize` + `marshalColumnarResult` (the
 * `getBuffer` zero-copy path); scalar inputs cross via `toPy`.
 */

import type { PyodideInterface } from 'pyodide';
import type { PyProxy } from 'pyodide/ffi';

import type { Operation } from '../api/params';
import { marshalColumnarResult } from '../output/marshal';
import { wrapPythonError } from '../util/errors';

/** JSON-safe summary returned by the `describe_dataframe` probe. */
export interface DataFrameProbe {
  columns: string[];
  n_rows: number;
  column_sums: Record<string, number>;
}

/**
 * Typed view of the resident `bridge.py` module (a callable `PyProxy`
 * namespace). Python `str` returns auto-convert to JS `string`; every other
 * return is a `PyProxy` the caller must convert and destroy.
 */
export interface BridgeModule {
  pyicare_version(): string;
  runtime_versions(): PyProxy;
  describe_dataframe(columns: PyProxy): PyProxy;
  run(op: string, kwargs: PyProxy, frames?: PyProxy): PyProxy;
  columnarize(result: PyProxy, op: string): PyProxy;
  /** The namespace is itself a `PyProxy`; released in `Engine.close()`. */
  destroy(): void;
}

const BRIDGE_SRC_GLOBAL = '__icare_bridge_src__';

/**
 * Define `bridge.py` as a named module in `sys.modules` and return the module
 * proxy (held for the engine's lifetime).
 *
 * The source is injected via a temporary global + `exec(compile(...))` rather
 * than string-concatenated into `runPython`, so there is no quoting/escaping
 * hazard. The temporary global is removed in `finally`.
 */
export function defineBridge(
  pyodide: PyodideInterface,
  source: string,
  moduleName: string,
): BridgeModule {
  const name = JSON.stringify(moduleName);
  pyodide.globals.set(BRIDGE_SRC_GLOBAL, source);
  try {
    const module = pyodide.runPython(
      [
        'import sys, types',
        `__icare_m = types.ModuleType(${name})`,
        `exec(compile(${BRIDGE_SRC_GLOBAL}, ${JSON.stringify(`<${moduleName}>`)}, "exec"), __icare_m.__dict__)`,
        `sys.modules[${name}] = __icare_m`,
        '__icare_m',
      ].join('\n'),
    ) as BridgeModule;
    return module;
  } catch (error) {
    throw wrapPythonError('failed to define the icare bridge module', error);
  } finally {
    pyodide.globals.delete(BRIDGE_SRC_GLOBAL);
  }
}

/** JS-side callers of the bridge functions, each owning its proxies. */
export const runBridge = {
  /** `bridge.runtime_versions()` → plain object. */
  versions(bridge: BridgeModule): Record<string, string> {
    const proxy = bridge.runtime_versions();
    try {
      return proxy.toJs({ dict_converter: Object.fromEntries }) as Record<string, string>;
    } catch (error) {
      throw wrapPythonError('bridge.runtime_versions failed', error);
    } finally {
      proxy.destroy();
    }
  },

  /** Probe: `toPy(columns)` → `build_df` → summary → `toJs`. Round-trip check. */
  describeDataFrame(
    pyodide: PyodideInterface,
    bridge: BridgeModule,
    columns: Record<string, unknown>,
  ): DataFrameProbe {
    const columnsPy = pyodide.toPy(columns) as PyProxy;
    let proxy: PyProxy | undefined;
    try {
      proxy = bridge.describe_dataframe(columnsPy);
      return proxy.toJs({ dict_converter: Object.fromEntries }) as DataFrameProbe;
    } catch (error) {
      throw wrapPythonError('bridge.describe_dataframe failed', error);
    } finally {
      columnsPy.destroy();
      proxy?.destroy();
    }
  },

  /**
   * Dispatch a py-icare operation and marshal its result into a plain JS tree
   * with typed-array columns. `kwargs` is the snake_case, `undefined`-pruned
   * object from `toPythonKwargs`; `frames` is the optional object-sink map
   * (Phase 4).
   *
   * The DataFrame-mode result is reshaped by `bridge.columnarize` into
   * `{ structure, buffers }` and extracted zero-copy by `marshalColumnarResult`.
   * The raw dict never crosses to JS as data — it is passed straight back into
   * `columnarize` — so the only proxies to release are the transient inputs plus
   * `raw`/`columnar`.
   */
  run(
    pyodide: PyodideInterface,
    bridge: BridgeModule,
    op: Operation,
    kwargs: Record<string, unknown>,
    frames: Record<string, unknown> | null,
  ): unknown {
    const kwargsPy = pyodide.toPy(kwargs) as PyProxy;
    // Omit `frames` entirely when absent — Pyodide 314 maps JS `null` to a
    // `JsNull` object (not Python `None`), so passing `null` would break the
    // `frames is not None` guard; a missing arg uses py-icare's `None` default.
    const framesPy = frames != null ? (pyodide.toPy(frames) as PyProxy) : undefined;
    let raw: PyProxy | undefined;
    let columnar: PyProxy | undefined;
    try {
      raw = framesPy !== undefined ? bridge.run(op, kwargsPy, framesPy) : bridge.run(op, kwargsPy);
      columnar = bridge.columnarize(raw, op);
      return marshalColumnarResult(columnar);
    } catch (error) {
      throw wrapPythonError(`bridge.run(${op}) failed`, error);
    } finally {
      kwargsPy.destroy();
      framesPy?.destroy();
      raw?.destroy();
      columnar?.destroy();
    }
  },
};
