/**
 * `summarizeDistribution` — a faithful JS port of py-icare's
 * `tests/icare_test_utils.summarize_distribution`.
 *
 * Matches numpy's default linear quantile method (= R type-7: interpolate at
 * `h = (n-1)p` on the sorted values) and the sample standard deviation
 * (`ddof=1`), so summaries compare against the R-derived goldens. Emits the same
 * keys: `n, min, q1, median, mean, q3, max, sd`.
 */

export interface DistributionSummary {
  n: number;
  min: number;
  q1: number;
  median: number;
  mean: number;
  q3: number;
  max: number;
  sd: number;
}

export function summarizeDistribution(values: ArrayLike<number>): DistributionSummary {
  const x = Array.from(values, Number);
  const n = x.length;
  if (n === 0) {
    throw new Error('summarizeDistribution: empty input');
  }
  x.sort((a, b) => a - b);

  let sum = 0;
  for (const value of x) sum += value;
  const mean = sum / n;

  let sumSquares = 0;
  for (const value of x) sumSquares += (value - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(sumSquares / (n - 1)) : 0;

  return {
    n,
    min: at(x, 0),
    q1: quantileType7(x, 0.25),
    median: quantileType7(x, 0.5),
    mean,
    q3: quantileType7(x, 0.75),
    max: at(x, n - 1),
    sd,
  };
}

/** numpy default (`linear`) quantile = R type-7: interpolate at `h = (n-1)p`. */
function quantileType7(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return at(sorted, 0);
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  const low = at(sorted, lo);
  return low + (h - lo) * (at(sorted, hi) - low);
}

function at(arr: number[], index: number): number {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`index ${index} out of bounds (length ${arr.length})`);
  }
  return value;
}
