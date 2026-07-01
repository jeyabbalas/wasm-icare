#!/usr/bin/env node
/**
 * Build the pure-Python pyicare wheel from a local py-icare checkout and vendor
 * it into assets/wheels/. The target version is read from src/runtime/config.ts
 * (PYICARE_VERSION) — the single source of truth — and the built wheel's version
 * is asserted to match.
 *
 * Usage:
 *   node scripts/vendor-wheel.mjs
 *
 * Source root: $PYICARE_REPO, else the sibling checkout ../../py-icare.
 * Builder: `uv build` if available (isolated, no global installs), else
 * `python -m build` ($PYTHON overrides the interpreter; requires the `build`
 * package). Both produce an identical `pyicare-<version>-py3-none-any.whl`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pyicareRepo = process.env.PYICARE_REPO
  ? resolve(process.env.PYICARE_REPO)
  : resolve(scriptDir, '..', '..', 'py-icare');

const expectedVersion = readExpectedVersion();
const expectedWheel = `pyicare-${expectedVersion}-py3-none-any.whl`;
const wheelsDir = join(repoRoot, 'assets', 'wheels');

function readExpectedVersion() {
  const src = readFileSync(join(repoRoot, 'src', 'runtime', 'config.ts'), 'utf8');
  const m = src.match(/PYICARE_VERSION\s*=\s*'([^']+)'/);
  if (!m) {
    console.error('✖ Could not read PYICARE_VERSION from src/runtime/config.ts');
    process.exit(1);
  }
  return m[1];
}

function hasCommand(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function buildWheel(outDir) {
  if (hasCommand('uv')) {
    console.log('• Building with `uv build` …');
    execFileSync('uv', ['build', '--wheel', '--out-dir', outDir, pyicareRepo], {
      stdio: 'inherit',
    });
    return;
  }
  const python = process.env.PYTHON || 'python3';
  console.log(`• Building with \`${python} -m build\` …`);
  execFileSync(python, ['-m', 'build', '--wheel', '--outdir', outDir, pyicareRepo], {
    stdio: 'inherit',
  });
}

function main() {
  if (!existsSync(join(pyicareRepo, 'pyproject.toml'))) {
    console.error(`✖ py-icare checkout not found at ${pyicareRepo}`);
    console.error('  Set PYICARE_REPO to your local py-icare checkout.');
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'pyicare-wheel-'));
  try {
    buildWheel(tmp);
    const wheels = readdirSync(tmp).filter((f) => f.endsWith('.whl'));
    if (wheels.length !== 1) {
      console.error(`✖ Expected exactly one wheel, found: ${wheels.join(', ') || '(none)'}`);
      process.exit(1);
    }
    const built = wheels[0];
    if (built !== expectedWheel) {
      console.error(`✖ Built wheel "${built}" != expected "${expectedWheel}".`);
      console.error('  Bump PYICARE_VERSION in src/runtime/config.ts, or check py-icare version.');
      process.exit(1);
    }
    mkdirSync(wheelsDir, { recursive: true });
    // Remove any stale wheels so only the pinned one is vendored.
    for (const f of readdirSync(wheelsDir).filter((f) => f.endsWith('.whl') && f !== built)) {
      rmSync(join(wheelsDir, f));
    }
    const dest = join(wheelsDir, built);
    copyFileSync(join(tmp, built), dest);
    const sha = createHash('sha256').update(readFileSync(dest)).digest('hex');
    console.log(`✓ Vendored assets/wheels/${built} (${statSync(dest).size} bytes)`);
    console.log(`  sha256: ${sha}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main();
