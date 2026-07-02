#!/usr/bin/env node
/**
 * Package publish gate. Runs `npm pack --dry-run --json` and asserts the tarball is
 * correct before it can ship:
 *   - no test data / Pyodide mirror / dependencies leak in,
 *   - the published entry points, their declarations, the vendored pyicare wheel,
 *     and the vendor CLI are all present,
 *   - the platform bundles stay under the size gate (regression guard for an
 *     accidental heavy dependency getting bundled).
 *
 * Exits non-zero on any violation. Assumes `npm run build` has produced `dist/`.
 *
 * Usage: node scripts/check-package.mjs   (or: npm run check-package)
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const SIZE_LIMIT_BYTES = 80 * 1024;

// No test data, no vendored Pyodide runtime, no deps, no downloaded cache.
const FORBIDDEN_PREFIXES = ['test/', 'full/', 'node_modules/', '.pyodide-cache/'];

const REQUIRED_FILES = [
  'dist/index.js',
  'dist/index.node.js',
  'dist/index.browser.js',
  'dist/worker.js',
  'dist/nodeWorker.js',
  'dist/index.d.ts',
  'dist/index.node.d.ts',
  'dist/index.browser.d.ts',
  'scripts/vendor-pyodide.mjs',
];

// Platform bundles gated for size (the ~500 KB apache-arrow inlining regression).
const GATED_BUNDLES = ['dist/index.node.js', 'dist/index.browser.js'];

function packFileList() {
  // `--ignore-scripts` skips the `prepack` build so stdout is pure JSON (this gate
  // measures the already-built dist/, per the note above).
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].files; // [{ path, size, mode }]
}

const files = packFileList();
const byPath = new Map(files.map((f) => [f.path, f]));
const errors = [];

for (const f of files) {
  if (FORBIDDEN_PREFIXES.some((p) => f.path.startsWith(p))) {
    errors.push(`forbidden file in package: ${f.path}`);
  }
}

for (const required of REQUIRED_FILES) {
  if (!byPath.has(required)) errors.push(`missing required file: ${required}`);
}

if (!files.some((f) => /^assets\/wheels\/pyicare-.*\.whl$/.test(f.path))) {
  errors.push('missing the vendored pyicare wheel under assets/wheels/');
}

for (const bundle of GATED_BUNDLES) {
  const f = byPath.get(bundle);
  if (f && f.size > SIZE_LIMIT_BYTES) {
    errors.push(
      `${bundle} is ${(f.size / 1024).toFixed(1)} KB, over the ${SIZE_LIMIT_BYTES / 1024} KB gate`,
    );
  }
}

if (errors.length > 0) {
  console.error('✗ package check failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✓ package check passed: ${files.length} files`);
for (const bundle of GATED_BUNDLES) {
  const f = byPath.get(bundle);
  if (f) console.log(`  ${bundle}: ${(f.size / 1024).toFixed(1)} KB (gate ${SIZE_LIMIT_BYTES / 1024} KB)`);
}
