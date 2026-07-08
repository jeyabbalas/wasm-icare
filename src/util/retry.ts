/**
 * Bounded retry-with-backoff for transient async failures.
 *
 * The Pyodide scientific stack and the pyicare wheel are fetched over the network
 * on a cold boot (jsDelivr, or a self-hosted mirror). A single dropped connection
 * there surfaces as a hard boot failure — e.g. `ModuleNotFoundError: No module
 * named 'pyarrow'` — even though the pinned wheel itself never changed. Wrapping
 * those `loadPackage` calls in {@link withRetry} lets a transient blip self-heal.
 *
 * Dependency-free and side-effect-free (see `"sideEffects": false` in package.json)
 * so it tree-shakes out of consumers that never hit a retry.
 */

/** Tuning + injectable clock for {@link withRetry}. */
export interface RetryOptions {
  /** Total attempts, including the first. `1` disables retrying. Default `3`. */
  attempts?: number;
  /** Delay before the first retry, in ms; doubles each subsequent retry. Default `500`. */
  baseDelayMs?: number;
  /** Multiplicative jitter ceiling in [0, 1): each delay is scaled by `1 + random*jitter`. Default `0.25`. */
  jitter?: number;
  /**
   * Sleep hook. Injected so tests can resolve instantly instead of waiting.
   * Defaults to a real `setTimeout`-backed delay.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Random source in [0, 1) for jitter. Injected for deterministic tests.
   * Defaults to `Math.random`.
   */
  random?: () => number;
  /** Called before each retry (not before the first attempt); useful for logging. */
  onRetry?: (error: unknown, attempt: number) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run `fn`, retrying on any thrown error up to `attempts` times with exponential
 * backoff + jitter. Resolves with the first success; rejects with the LAST error
 * once attempts are exhausted (so a genuinely-missing package still fails with its
 * original message, just after a few tries rather than on the first blip).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const jitter = options.jitter ?? 0.25;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      options.onRetry?.(error, attempt);
      const delay = baseDelayMs * 2 ** (attempt - 1) * (1 + random() * jitter);
      await sleep(delay);
    }
  }
  throw lastError;
}
