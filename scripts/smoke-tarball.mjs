#!/usr/bin/env node
/**
 * Scratch-project smoke test: pack the package, install the tarball into a throwaway
 * project, and import `wasm-icare` from it to prove the published artifact resolves
 * (conditional exports + declarations + the pyodide dependency) outside this repo.
 * Imports only — it does not boot Pyodide.
 *
 * Manual / local check (installs the pyodide dependency, so it needs network on a
 * cold cache). Assumes `npm run build` has produced `dist/`.
 *
 * Usage: node scripts/smoke-tarball.mjs   (or: npm run smoke-tarball)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const repo = resolve(process.cwd());

// Fresh build, then pack with `--ignore-scripts` so stdout is just the tarball name
// (the `prepack` build already ran here, and its output would otherwise mix in).
console.log('building + packing…');
execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'ignore' });
const tarballName = execFileSync('npm', ['pack', '--silent', '--ignore-scripts'], {
  cwd: repo,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean)
  .pop();
const tarball = join(repo, tarballName);

try {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-icare-smoke-'));
  try {
    execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
    console.log(`installing ${tarballName} into a scratch project…`);
    // --omit=optional: skip apache-arrow (also proves the import works without it).
    execFileSync(
      'npm',
      ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--omit=optional', tarball],
      { cwd: dir, stdio: 'inherit' },
    );

    writeFileSync(
      join(dir, 'probe.mjs'),
      [
        "import { PYICARE_VERSION, PYODIDE_VERSION, loadICARE } from 'wasm-icare';",
        "if (PYICARE_VERSION !== '1.3.0') { console.error('unexpected PYICARE_VERSION:', PYICARE_VERSION); process.exit(1); }",
        "if (typeof loadICARE !== 'function') { console.error('loadICARE is not a function'); process.exit(1); }",
        "console.log('imported wasm-icare OK — pyicare', PYICARE_VERSION, '/ pyodide', PYODIDE_VERSION);",
      ].join('\n'),
    );
    execFileSync('node', ['probe.mjs'], { cwd: dir, stdio: 'inherit' });
    console.log('✓ tarball smoke passed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} finally {
  rmSync(tarball, { force: true });
}
