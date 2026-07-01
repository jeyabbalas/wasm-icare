#!/usr/bin/env node
/**
 * Vendor the curated BPC3 + iCARE-Lit test fixtures and R-derived goldens from a
 * local py-icare checkout into this repo, and record a sha256 lockfile.
 *
 * Usage:
 *   node scripts/sync-fixtures.mjs            # copy fixtures + write test/fixtures.lock.json
 *   node scripts/sync-fixtures.mjs --verify   # recompute sha256 of vendored files vs the lock
 *
 * Source root resolution: $PYICARE_REPO, else the sibling checkout ../../py-icare.
 *
 * Only files READ BY the pytest suite are vendored. The 3–4 MB `validation_cohort*.csv`
 * files (R-generator / demo only) are intentionally excluded. Slow-gated fixtures
 * (nested case-control + GLM weights + iCARE-Lit validation cohort) are vendored too
 * and gated at test-selection time via RUN_SLOW.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..'); // wasm-icare/
const pyicareRepo = process.env.PYICARE_REPO
  ? resolve(process.env.PYICARE_REPO)
  : resolve(scriptDir, '..', '..', 'py-icare'); // ../../py-icare (sibling checkout)

const LOCK_PATH = join(repoRoot, 'test', 'fixtures.lock.json');

/** Groups of source files → destination directories (relative to repo root). */
const GROUPS = [
  {
    group: 'bpc3',
    destDir: 'test/fixtures/bpc3',
    files: [
      { src: 'data/BPC3/age_specific_breast_cancer_incidence_rates.csv' },
      { src: 'data/BPC3/age_specific_all_cause_mortality_rates.csv' },
      { src: 'data/BPC3/breast_cancer_covariate_model_formula.txt' },
      { src: 'data/BPC3/breast_cancer_model_log_odds_ratios.json' },
      { src: 'data/BPC3/breast_cancer_model_log_odds_ratios_post_50.json' },
      { src: 'data/BPC3/reference_covariate_data.csv' },
      { src: 'data/BPC3/reference_covariate_data_post_50.csv' },
      { src: 'data/BPC3/breast_cancer_72_snps_info.csv' },
      { src: 'data/BPC3/query_covariate_profile.csv' },
      { src: 'data/BPC3/query_snp_profile.csv' },
      { src: 'data/BPC3/validation_nested_case_control_data.csv', slow: true },
      { src: 'data/BPC3/validation_nested_case_control_covariate_data.csv', slow: true },
      { src: 'data/BPC3/validation_nested_case_control_snp_data.csv', slow: true },
      { src: 'tests/r_reference/fixtures/bpc3_nested_cc_glm_weights.csv', slow: true },
    ],
  },
  {
    group: 'icare-lit',
    destDir: 'test/fixtures/icare-lit',
    files: [
      { src: 'data/iCARE-Lit/age_specific_breast_cancer_incidence_rates.csv' },
      { src: 'data/iCARE-Lit/age_specific_all_cause_mortality_rates.csv' },
      { src: 'data/iCARE-Lit/model_formula_lt50.txt' },
      { src: 'data/iCARE-Lit/model_formula_ge50.txt' },
      { src: 'data/iCARE-Lit/model_log_odds_ratios_lt50.json' },
      { src: 'data/iCARE-Lit/model_log_odds_ratios_ge50.json' },
      { src: 'data/iCARE-Lit/reference_covariate_data_lt50.csv' },
      { src: 'data/iCARE-Lit/reference_covariate_data_ge50.csv' },
      { src: 'tests/r_reference/fixtures/icare_lit_query_lt50.csv' },
      { src: 'tests/r_reference/fixtures/icare_lit_query_ge50.csv' },
      { src: 'tests/r_reference/fixtures/icare_lit_validation_study.csv', slow: true },
      { src: 'tests/r_reference/fixtures/icare_lit_validation_covariates.csv', slow: true },
    ],
  },
  {
    group: 'golden',
    destDir: 'test/golden',
    files: [
      'bpc3_covariate_only.json',
      'bpc3_snp_only_no_profile.json',
      'bpc3_snp_only_with_profile.json',
      'bpc3_combined.json',
      'bpc3_split_interval_covariate_only.json',
      'bpc3_split_interval_combined.json',
      'bpc3_validation_covariate_only.json',
      'bpc3_validation_combined.json',
      'icare_lit_covariate_only_lt50.json',
      'icare_lit_covariate_only_ge50.json',
      'icare_lit_split_interval.json',
      'icare_lit_validation.json',
    ].map((name) => ({ src: `tests/r_reference/expected/${name}` })),
  },
];

const MANIFEST = GROUPS.flatMap((g) =>
  g.files.map((f) => ({
    group: g.group,
    src: f.src,
    slow: Boolean(f.slow),
    dest: join(g.destDir, basename(f.src)),
  })),
);

function sha256(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function pyicareGitRef() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: pyicareRepo })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function runSync() {
  if (!existsSync(pyicareRepo)) {
    console.error(`✖ py-icare checkout not found at ${pyicareRepo}`);
    console.error('  Set PYICARE_REPO to your local py-icare checkout.');
    process.exit(1);
  }
  const entries = [];
  const missing = [];
  for (const m of MANIFEST) {
    const srcAbs = join(pyicareRepo, m.src);
    if (!existsSync(srcAbs)) {
      missing.push(m.src);
      continue;
    }
    const destAbs = join(repoRoot, m.dest);
    mkdirSync(dirname(destAbs), { recursive: true });
    copyFileSync(srcAbs, destAbs);
    entries.push({
      group: m.group,
      src: m.src,
      dest: m.dest,
      slow: m.slow,
      bytes: statSync(destAbs).size,
      sha256: sha256(destAbs),
    });
  }
  if (missing.length) {
    console.error(`✖ ${missing.length} source file(s) not found under ${pyicareRepo}:`);
    for (const s of missing) console.error(`   - ${s}`);
    process.exit(1);
  }
  entries.sort((a, b) => a.dest.localeCompare(b.dest));
  const totalBytes = entries.reduce((a, e) => a + e.bytes, 0);
  const lock = {
    description:
      'sha256 lockfile for vendored py-icare test fixtures/goldens. Regenerate with `npm run sync-fixtures`; verify with `npm run verify-fixtures`.',
    pyicareRef: pyicareGitRef(),
    fileCount: entries.length,
    totalBytes,
    files: entries,
  };
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
  const slowCount = entries.filter((e) => e.slow).length;
  console.log(
    `✓ Vendored ${entries.length} files (${fmtBytes(totalBytes)}; ${slowCount} slow) → test/fixtures, test/golden`,
  );
  console.log('✓ Wrote test/fixtures.lock.json');
}

function runVerify() {
  if (!existsSync(LOCK_PATH)) {
    console.error('✖ test/fixtures.lock.json not found — run `npm run sync-fixtures` first.');
    process.exit(1);
  }
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  const problems = [];
  const lockDests = new Set(lock.files.map((f) => f.dest));

  for (const f of lock.files) {
    const abs = join(repoRoot, f.dest);
    if (!existsSync(abs)) {
      problems.push(`missing vendored file: ${f.dest}`);
      continue;
    }
    if (statSync(abs).size !== f.bytes) problems.push(`size mismatch: ${f.dest}`);
    if (sha256(abs) !== f.sha256) problems.push(`sha256 mismatch: ${f.dest}`);
  }
  for (const m of MANIFEST) {
    if (!lockDests.has(m.dest)) problems.push(`manifest entry absent from lock: ${m.dest}`);
  }

  if (problems.length) {
    console.error(`✖ Fixture verification failed (${problems.length}):`);
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }
  console.log(`✓ ${lock.files.length} vendored fixtures match test/fixtures.lock.json`);
}

if (process.argv.includes('--verify')) {
  runVerify();
} else {
  runSync();
}
