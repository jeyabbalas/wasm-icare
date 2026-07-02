import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { ICARE } from '../../../src/api/types';
import { loadICARE } from '../../../src/index.node';
import { pyicareWheelPath, pyodideIndexPath } from '../../../src/runtime/assets-node';
import { PYICARE_WHEEL_FILENAME } from '../../../src/runtime/config';
import { assertAllClose } from '../../helpers/assert';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { ATOL_DETERMINISTIC } from '../../helpers/tolerances';

/**
 * Phase 8 — `loadICARE({ offline: true, indexURL, pyicareWheelUrl })` in Node, booted
 * from a self-contained Pyodide mirror (the layout `npx wasm-icare-vendor <dir>`
 * produces). The mirror is assembled here from the installed `pyodide` core runtime
 * + the scientific wheels warmed into `.pyodide-cache` (globalSetup) + the vendored
 * pyicare wheel, then used as BOTH `indexURL` and — because bootstrapNodeEngine
 * redirects the package cache to the mirror on offline boot — the wheel source. No
 * network: every asset resolves inside the temp mirror.
 */

// The Pyodide core files loadPyodide reads from `indexURL` (mirrors what the CLI copies).
const CORE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
] as const;

// Prefixes of the wheels a BPC3 compute needs present in the mirror (diagnostic guard).
const REQUIRED_WHEEL_PREFIXES = ['numpy-', 'pandas-', 'scipy-', 'patsy-'] as const;

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
}

/** Assemble a complete offline mirror in a fresh temp dir; returns its path. */
function buildMirror(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-icare-mirror-'));

  const pyodideDir = pyodideIndexPath(); // node_modules/pyodide/ (trailing slash)
  for (const file of CORE_FILES) copyFileSync(join(pyodideDir, file), join(dir, file));

  // The scientific stack (numpy/pandas/scipy/patsy + transitive deps) warmed into
  // .pyodide-cache; copy every cached wheel so the lockfile's file_names resolve.
  const cacheDir = resolve(process.cwd(), '.pyodide-cache');
  for (const file of readdirSync(cacheDir)) {
    if (file.endsWith('.whl')) copyFileSync(join(cacheDir, file), join(dir, file));
  }

  // The vendored pyicare wheel.
  copyFileSync(pyicareWheelPath(), join(dir, PYICARE_WHEEL_FILENAME));

  // Fail loudly (not with a confusing boot error) if the cache was not warmed.
  const present = readdirSync(dir);
  for (const prefix of REQUIRED_WHEEL_PREFIXES) {
    if (!present.some((f) => f.startsWith(prefix) && f.endsWith('.whl'))) {
      throw new Error(`offline mirror is missing a ${prefix}*.whl (was .pyodide-cache warmed?)`);
    }
  }
  return dir;
}

describe('offline Node boot from a vendored mirror', () => {
  let mirror: string;
  let icare: ICARE;

  beforeAll(async () => {
    mirror = buildMirror();
    icare = await loadICARE({
      indexURL: `${mirror}/`,
      pyicareWheelUrl: join(mirror, PYICARE_WHEEL_FILENAME),
      offline: true,
    });
  });

  afterAll(async () => {
    await icare?.close();
    if (mirror) rmSync(mirror, { recursive: true, force: true });
  });

  test('offline:true without an indexURL is rejected before any boot', async () => {
    await expect(loadICARE({ offline: true })).rejects.toThrow(/indexURL/i);
  });

  test('offline:true without a pyicareWheelUrl is rejected', async () => {
    await expect(loadICARE({ offline: true, indexURL: `${mirror}/` })).rejects.toThrow(
      /pyicareWheelUrl/i,
    );
  });

  test('the mirror carries the pyicare wheel by its pinned filename', () => {
    expect(basename(pyicareWheelPath())).toBe(PYICARE_WHEEL_FILENAME);
    expect(existsSync(join(mirror, PYICARE_WHEEL_FILENAME))).toBe(true);
  });

  test('a BPC3 compute from the offline mirror matches the golden', async () => {
    const golden = loadGolden<CovariateGolden>('bpc3_covariate_only.json');
    const result = await icare.computeAbsoluteRisk({
      applyAgeStart: golden.age_start,
      applyAgeIntervalLength: golden.age_interval_length,
      modelDiseaseIncidenceRates: { path: bpc3('age_specific_breast_cancer_incidence_rates.csv') },
      modelCompetingIncidenceRates: { path: bpc3('age_specific_all_cause_mortality_rates.csv') },
      modelCovariateFormula: { path: bpc3('breast_cancer_covariate_model_formula.txt') },
      modelLogRelativeRisk: { path: bpc3('breast_cancer_model_log_odds_ratios.json') },
      modelReferenceDataset: { path: bpc3('reference_covariate_data.csv') },
      applyCovariateProfile: { path: bpc3('query_covariate_profile.csv') },
      returnLinearPredictors: true,
    });

    assertAllClose(result.profile.columns.risk_estimates as Float64Array, golden.risks, ATOL_DETERMINISTIC);
    assertAllClose(
      result.profile.columns.linear_predictors as Float64Array,
      golden.linear_predictors,
      ATOL_DETERMINISTIC,
    );
  });
});
