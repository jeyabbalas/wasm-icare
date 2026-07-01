/**
 * Absolute paths to vendored fixtures under `test/fixtures/`, resolved relative
 * to this module (cwd-independent). Used to feed `{ path }` inputs to the SDK.
 */

import { fileURLToPath } from 'node:url';

export function fixturePath(relative: string): string {
  return fileURLToPath(new URL(`../fixtures/${relative}`, import.meta.url));
}

/** Absolute path to a BPC3 fixture file. */
export function bpc3(name: string): string {
  return fixturePath(`bpc3/${name}`);
}

/** Absolute path to an iCARE-Lit fixture file. */
export function icareLit(name: string): string {
  return fixturePath(`icare-lit/${name}`);
}
