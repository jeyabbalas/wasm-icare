/**
 * Pinned runtime versions — the ONLY place these numbers live.
 *
 * Swapping the vendored pyicare wheel to a new release is a one-line change here
 * plus dropping the new `.whl` into `assets/wheels/` (see scripts/vendor-wheel.mjs).
 */

/** Pyodide distribution pinned for reproducible, offline-capable boots. */
export const PYODIDE_VERSION = '314.0.2';

/**
 * py-icare wheel version vendored in `assets/wheels/`.
 *
 * `1.3.0` adds the fit-once / apply-many API (`build_absolute_risk_model` +
 * `AbsoluteRiskModel.apply_to_profile`) on top of 1.2.0's in-memory I/O + columnar
 * (`output_format='dataframe'`) output. Bump this constant and re-run
 * `scripts/vendor-wheel.mjs` to rebuild and swap the vendored wheel.
 */
export const PYICARE_VERSION = '1.3.0';

/** Filename of the vendored wheel; pure-Python `py3-none-any`. */
export const PYICARE_WHEEL_FILENAME = `pyicare-${PYICARE_VERSION}-py3-none-any.whl`;

/** Path (relative to the package root) of the vendored wheel. */
export const PYICARE_WHEEL_PATH = `assets/wheels/${PYICARE_WHEEL_FILENAME}`;

/**
 * Core Pyodide packages pyicare 1.3.0 needs at load time.
 *
 * numpy/pandas/scipy/patsy are pyicare's direct imports; each is a lockfile
 * package, so `loadPackage` also resolves their `depends` (python-dateutil /
 * pytz / six). `packaging` is listed explicitly because patsy imports it at
 * module load but it is NOT in patsy's lockfile `depends`, so it would
 * otherwise be missing. These are loaded BEFORE the vendored pyicare wheel
 * (installed by path, `depends:[]`, so its imports must already be satisfiable).
 * `pyarrow` is intentionally absent — not a runtime dependency of pyicare
 * (verified against the wheel METADATA and the `icare/*.py` module imports).
 */
export const PYODIDE_DEFAULT_PACKAGES = [
  'numpy',
  'pandas',
  'scipy',
  'patsy',
  'packaging',
] as const;

/**
 * JsDelivr base URL for a pinned Pyodide distribution — used for browser
 * self-hosting / CDN override (Phase 7). The Node bootstrap does NOT use this:
 * it auto-locates its snapshot from `node_modules/pyodide`.
 */
export const PYODIDE_CDN_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Name under which the resident Python bridge module is registered in `sys.modules`. */
export const ICARE_BRIDGE_MODULE = 'icare_bridge';
