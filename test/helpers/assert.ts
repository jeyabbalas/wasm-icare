/**
 * Numeric assert helpers mirroring py-icare's test utilities, so JS specs assert
 * the same way as the Python cross-validation suite.
 */

import { expect } from 'vitest';

import type { DistributionSummary } from './summarize';

/**
 * Mirror of `numpy.testing.assert_allclose`: element-wise
 * `|actual - desired| <= atol + rtol * |desired|` (numpy defaults `rtol=1e-7`).
 */
export function assertAllClose(
  actual: ArrayLike<number>,
  desired: ArrayLike<number>,
  atol: number,
  rtol = 1e-7,
): void {
  expect(actual.length).toBe(desired.length);
  for (let i = 0; i < desired.length; i++) {
    const a = actual[i] as number;
    const d = desired[i] as number;
    expect(Math.abs(a - d)).toBeLessThanOrEqual(atol + rtol * Math.abs(d));
  }
}

/**
 * Mirror of py-icare's `assert_distribution_close`: compare the given summary
 * keys against a golden summary at absolute tolerance `atol`.
 */
export function assertDistributionClose(
  summary: DistributionSummary,
  golden: Readonly<Record<string, number>>,
  atol: number,
  keys: readonly (keyof DistributionSummary)[],
): void {
  for (const key of keys) {
    const gold = golden[key];
    if (gold === undefined) {
      throw new Error(`golden summary is missing key '${key}'`);
    }
    expect(Math.abs(summary[key] - gold)).toBeLessThanOrEqual(atol);
  }
}
