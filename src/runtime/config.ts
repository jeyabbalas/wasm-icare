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
 * Phase 0 vendors a `1.1.0` placeholder built from the local py-icare checkout.
 * Phase 1 releases `1.2.0` (in-memory I/O + columnar output); bump this constant
 * and replace the wheel file to adopt it.
 */
export const PYICARE_VERSION = '1.1.0';

/** Filename of the vendored wheel; pure-Python `py3-none-any`. */
export const PYICARE_WHEEL_FILENAME = `pyicare-${PYICARE_VERSION}-py3-none-any.whl`;

/** Path (relative to the package root) of the vendored wheel. */
export const PYICARE_WHEEL_PATH = `assets/wheels/${PYICARE_WHEEL_FILENAME}`;
