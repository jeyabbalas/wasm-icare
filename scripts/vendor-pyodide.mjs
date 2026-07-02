#!/usr/bin/env node
/**
 * Vendor a self-contained Pyodide distribution for offline / self-hosted use.
 *
 * Produces a directory that `loadICARE` can boot from with no network:
 *   - the Pyodide core runtime (from the installed `pyodide` dependency),
 *   - the scientific wheels wasm-icare loads (numpy/pandas/scipy/patsy + their
 *     transitive deps), fetched from the pinned jsDelivr mirror and sha256-checked
 *     against `pyodide-lock.json` (or reused if already present in the target),
 *   - the vendored pyicare wheel (from this package's `assets/wheels/`).
 *
 * Usage:
 *   npx wasm-icare-vendor <targetDir> [--packages pyarrow,foo]
 *   node scripts/vendor-pyodide.mjs ./public/pyodide
 *
 * Everything is resolved from the installed `pyodide` package + this package's own
 * assets — it reads no `src/` (which is not published), so it works both from a repo
 * checkout and from the installed npm package. Requires Node >= 18 (global `fetch`).
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const nodeRequire = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));

// The core files loadPyodide reads from `indexURL` (matches the offline test's mirror).
const CORE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

// The SDK's default loadPackage set — mirrors PYODIDE_DEFAULT_PACKAGES in
// src/runtime/config.ts. Transitive `depends` are resolved from the lockfile, so
// only the roots are listed here.
const BASE_PACKAGES = ['numpy', 'pandas', 'scipy', 'patsy', 'packaging'];

function fail(message) {
  console.error(`wasm-icare-vendor: ${message}`);
  process.exit(1);
}

/** PEP 503 name normalization (matches pyodide's lockfile keys). */
function normalize(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function printHelp() {
  console.log(
    'Usage: wasm-icare-vendor <targetDir> [--packages a,b]\n\n' +
      'Vendor the pinned Pyodide runtime + scientific wheels + the pyicare wheel into\n' +
      '<targetDir> for offline / self-hosted use.',
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let target;
  let cache;
  const extras = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg === '--packages') {
      extras.push(...(args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--packages=')) {
      extras.push(...arg.slice('--packages='.length).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--cache') {
      cache = args[++i];
    } else if (arg.startsWith('--cache=')) {
      cache = arg.slice('--cache='.length);
    } else if (!arg.startsWith('-') && target === undefined) {
      target = arg;
    } else {
      fail(`unexpected argument: ${arg}`);
    }
  }
  if (target === undefined) fail('missing <targetDir>. Try `wasm-icare-vendor --help`.');
  // A local Pyodide package cache to source wheels from before hitting the CDN.
  // Defaults to `.pyodide-cache` under cwd (present in a wasm-icare checkout / after
  // a run); absent in a fresh consumer project, where every wheel is downloaded.
  return { target: resolve(target), extras, cacheDir: resolve(cache ?? '.pyodide-cache') };
}

/** Locate the installed pyodide package directory (a declared dependency). */
function resolvePyodideDir() {
  try {
    return dirname(nodeRequire.resolve('pyodide/package.json'));
  } catch {
    return fail("could not resolve the 'pyodide' package — is it installed?");
  }
}

/** Locate the vendored pyicare wheel in this package's assets/wheels/. */
function resolvePyicareWheel() {
  const wheelsDir = resolve(scriptDir, '..', 'assets', 'wheels');
  const wheel = existsSync(wheelsDir)
    ? readdirSync(wheelsDir).find((f) => f.startsWith('pyicare-') && f.endsWith('.whl'))
    : undefined;
  if (!wheel) return fail(`could not find the vendored pyicare wheel under ${wheelsDir}`);
  return join(wheelsDir, wheel);
}

/** Transitive closure of `roots` over the lockfile's `depends`. */
function resolveClosure(lock, roots, pyodideVersion) {
  const byName = new Map();
  for (const entry of Object.values(lock.packages)) byName.set(normalize(entry.name), entry);

  const seen = new Set();
  const stack = roots.map(normalize);
  const out = [];
  while (stack.length > 0) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const pkg = byName.get(name);
    if (!pkg) fail(`package "${name}" is not in pyodide-lock.json (pyodide ${pyodideVersion})`);
    out.push(pkg);
    for (const dep of pkg.depends ?? []) stack.push(normalize(dep));
  }
  return out;
}

/**
 * Ensure `pkg`'s wheel is in `target`, verified against the lockfile sha256:
 * reuse a byte-identical copy already there, else copy it from the local cache,
 * else download it from the CDN.
 */
async function ensureWheel(pkg, target, cdnBase, cacheDir) {
  const dest = join(target, pkg.file_name);
  if (existsSync(dest) && sha256(readFileSync(dest)) === pkg.sha256) return 'reused';

  const cached = join(cacheDir, pkg.file_name);
  if (existsSync(cached) && sha256(readFileSync(cached)) === pkg.sha256) {
    copyFileSync(cached, dest);
    return 'cached';
  }

  const url = `${cdnBase}${pkg.file_name}`;
  const res = await fetch(url);
  if (!res.ok) fail(`failed to download ${url}: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const got = sha256(buffer);
  if (pkg.sha256 && got !== pkg.sha256) {
    fail(`sha256 mismatch for ${pkg.file_name}: expected ${pkg.sha256}, got ${got}`);
  }
  writeFileSync(dest, buffer);
  return 'downloaded';
}

const { target, extras, cacheDir } = parseArgs(process.argv);

const pyodideDir = resolvePyodideDir();
const pyodideVersion = JSON.parse(readFileSync(join(pyodideDir, 'package.json'), 'utf8')).version;
const cdnBase = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
const pyicareWheel = resolvePyicareWheel();

mkdirSync(target, { recursive: true });

for (const file of CORE_FILES) {
  const src = join(pyodideDir, file);
  if (!existsSync(src)) fail(`missing Pyodide core file: ${src}`);
  copyFileSync(src, join(target, file));
}

const lock = JSON.parse(readFileSync(join(pyodideDir, 'pyodide-lock.json'), 'utf8'));
const closure = resolveClosure(lock, [...BASE_PACKAGES, ...extras], pyodideVersion);

let downloaded = 0;
let local = 0;
for (const pkg of closure) {
  const outcome = await ensureWheel(pkg, target, cdnBase, cacheDir);
  if (outcome === 'downloaded') downloaded++;
  else local++;
}

const pyicareName = basename(pyicareWheel);
copyFileSync(pyicareWheel, join(target, pyicareName));

console.log(`✓ vendored Pyodide ${pyodideVersion} → ${target}`);
console.log(
  `  ${CORE_FILES.length} core files, ${closure.length} wheels ` +
    `(${downloaded} downloaded, ${local} from cache), + ${pyicareName}`,
);
console.log('');
console.log('Boot offline from it — Node (filesystem path):');
console.log(`  loadICARE({ indexURL: '${target}/', pyicareWheelUrl: '${join(target, pyicareName)}', offline: true })`);
console.log('');
console.log('…or the browser (served under e.g. /pyodide/):');
console.log(`  loadICARE({ indexURL: '/pyodide/', pyicareWheelUrl: '/pyodide/${pyicareName}', offline: true })`);
