/**
 * Error types for wasm-icare.
 *
 * Minimal in Phase 2 — a base error plus a wrapper that surfaces a Pyodide
 * `PythonError`'s traceback as a legible JS error (boot/import failures).
 * Extended in later phases (e.g. a `HeapExhaustedError` mapped from a Python
 * `MemoryError` for the 1M-row path).
 */

/** Base class for every error thrown by the SDK. */
export class ICAREError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ICAREError';
  }
}

/** A failure that originated in Python; carries the Python traceback text. */
export class ICAREPythonError extends ICAREError {
  /** The raw Python traceback / message, if available. */
  readonly pythonTraceback: string | undefined;

  constructor(
    message: string,
    pythonTraceback?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ICAREPythonError';
    this.pythonTraceback = pythonTraceback;
  }
}

function isPyodidePythonError(error: unknown): error is { name: string; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'PythonError'
  );
}

/**
 * Wrap an error thrown across the Pyodide boundary in an {@link ICAREError}.
 *
 * A Pyodide `PythonError` has `name === 'PythonError'` and a `message` that is
 * the formatted Python traceback; it is re-wrapped as an
 * {@link ICAREPythonError} with `context` prepended and the original kept as
 * `cause`. Anything already an {@link ICAREError} is returned unchanged.
 */
export function wrapPythonError(context: string, error: unknown): ICAREError {
  if (error instanceof ICAREError) return error;
  if (isPyodidePythonError(error)) {
    const traceback = error.message;
    return new ICAREPythonError(`${context}: ${traceback ?? 'Python error'}`, traceback, {
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ICAREError(`${context}: ${message}`, { cause: error });
}
