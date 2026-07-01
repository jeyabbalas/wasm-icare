/**
 * Load vendored R-derived golden JSON from `test/golden/`. Path resolution is
 * relative to this module so it works regardless of the cwd Vitest runs from.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadGolden<T = Record<string, unknown>>(name: string): T {
  const path = fileURLToPath(new URL(`../golden/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
