import { describe, expect, test } from 'vitest';

import { summarizeDistribution } from '../helpers/summarize';

/**
 * Independent (Pyodide-free) verification that `summarizeDistribution` matches
 * numpy's default linear quantile (R type-7) and sample sd (ddof=1). This
 * de-risks the golden comparison in the BPC3 E2E: if the port drifted, this
 * fails in milliseconds without booting Pyodide.
 */
describe('summarizeDistribution', () => {
  test('odd-length vector: exact quantiles + ddof=1 sd', () => {
    const s = summarizeDistribution([1, 2, 3, 4, 5]);
    expect(s.n).toBe(5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.mean).toBe(3);
    expect(s.q1).toBe(2); // h = 4*0.25 = 1 -> sorted[1]
    expect(s.median).toBe(3); // h = 4*0.5 = 2 -> sorted[2]
    expect(s.q3).toBe(4); // h = 4*0.75 = 3 -> sorted[3]
    expect(s.sd).toBeCloseTo(Math.sqrt(2.5), 12); // var = 10/4
  });

  test('even-length vector: interpolated quantiles', () => {
    const s = summarizeDistribution([1, 2, 3, 4]);
    expect(s.q1).toBeCloseTo(1.75, 12); // h = 3*0.25 = 0.75
    expect(s.median).toBeCloseTo(2.5, 12); // h = 1.5 -> avg(2,3)
    expect(s.q3).toBeCloseTo(3.25, 12); // h = 2.25
    expect(s.mean).toBe(2.5);
    expect(s.sd).toBeCloseTo(Math.sqrt(5 / 3), 12);
  });

  test('interpolates at non-integer positions', () => {
    const s = summarizeDistribution([10, 20, 30, 40, 50, 60, 70]);
    expect(s.q1).toBeCloseTo(25, 12); // h = 1.5 -> 20 + 0.5*(30-20)
    expect(s.median).toBe(40);
    expect(s.q3).toBeCloseTo(55, 12); // h = 4.5 -> 50 + 0.5*(60-50)
  });

  test('is order-independent', () => {
    expect(summarizeDistribution([5, 3, 1, 4, 2])).toEqual(
      summarizeDistribution([1, 2, 3, 4, 5]),
    );
  });

  test('accepts a Float64Array (the E2E output type)', () => {
    const s = summarizeDistribution(new Float64Array([1, 2, 3, 4, 5]));
    expect(s.q1).toBe(2);
    expect(s.median).toBe(3);
    expect(s.q3).toBe(4);
  });
});
