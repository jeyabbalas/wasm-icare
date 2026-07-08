import { describe, expect, test, vi } from 'vitest';

import { withRetry } from '../../src/util/retry';

/** A `sleep` that records the delays it was asked for and resolves instantly. */
function fakeSleep() {
  const delays: number[] = [];
  const sleep = vi.fn((ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  });
  return { sleep, delays };
}

describe('withRetry', () => {
  test('returns the result without sleeping when the first attempt succeeds', async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn(() => Promise.resolve('ok'));

    await expect(withRetry(fn, { sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('retries transient failures and resolves once fn succeeds', async () => {
    const { sleep } = fakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip 1'))
      .mockRejectedValueOnce(new Error('blip 2'))
      .mockResolvedValueOnce('recovered');

    await expect(withRetry(fn, { attempts: 3, sleep })).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // one sleep before each retry
  });

  test('rethrows the LAST error after exhausting attempts', async () => {
    const { sleep } = fakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValue(new Error('last'));

    await expect(withRetry(fn, { attempts: 3, sleep })).rejects.toThrow('last');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('attempts:1 disables retrying — fails on the first error, never sleeps', async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withRetry(fn, { attempts: 1, sleep })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('backoff is exponential; jitter stays within [delay, delay*(1+jitter))', async () => {
    const { sleep, delays } = fakeSleep();
    // random()=0.5, jitter=0.2 => each delay scaled by 1.1; base 100 => 110, 220, 440.
    const fn = vi.fn().mockRejectedValue(new Error('always'));

    await expect(
      withRetry(fn, { attempts: 4, baseDelayMs: 100, jitter: 0.2, random: () => 0.5, sleep }),
    ).rejects.toThrow('always');
    expect(delays).toHaveLength(3);
    expect(delays[0]!).toBeCloseTo(110, 6);
    expect(delays[1]!).toBeCloseTo(220, 6);
    expect(delays[2]!).toBeCloseTo(440, 6);
  });

  test('invokes onRetry before each retry with the error and attempt index', async () => {
    const { sleep } = fakeSleep();
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new Error('e1')).mockResolvedValueOnce('done');

    await withRetry(fn, { sleep, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });
});
