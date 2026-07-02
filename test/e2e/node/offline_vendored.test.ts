import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { ICARE } from '../../../src/api/types';
import { loadICARE } from '../../../src/index.node';
import { pyicareWheelPath } from '../../../src/runtime/assets-node';
import { PYICARE_WHEEL_FILENAME } from '../../../src/runtime/config';
import { assertAllClose } from '../../helpers/assert';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { ATOL_DETERMINISTIC } from '../../helpers/tolerances';

/**
 * Phase 8 — end-to-end proof of the offline self-host path: run the real
 * `wasm-icare-vendor` CLI to produce a Pyodide mirror, then boot
 * `loadICARE({ offline: true, indexURL, pyicareWheelUrl })` from it and match the
 * BPC3 golden. bootstrapNodeEngine redirects the package cache to the mirror on
 * offline boot, so every asset resolves inside the temp dir — no network. The CLI
 * sources its wheels from `.pyodide-cache` (warmed by the e2e globalSetup) via
 * `--cache`, so this spec needs no network either.
 */

const CLI = fileURLToPath(new URL('../../../scripts/vendor-pyodide.mjs', import.meta.url));
const PYODIDE_CACHE = resolve(process.cwd(), '.pyodide-cache');

// Wheels a BPC3 compute needs present in the mirror (diagnostic guard).
const REQUIRED_WHEEL_PREFIXES = ['numpy-', 'pandas-', 'scipy-', 'patsy-'] as const;

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
}

/** Run the vendor CLI into a fresh temp dir and return the mirror path. */
function vendorMirror(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-icare-mirror-'));
  execFileSync('node', [CLI, dir, '--cache', PYODIDE_CACHE], { stdio: 'pipe' });
  return dir;
}

describe('offline Node boot from a vendored mirror', () => {
  let mirror: string;
  let icare: ICARE;

  beforeAll(async () => {
    mirror = vendorMirror();
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

  test('the CLI mirror carries the core runtime + required wheels + the pyicare wheel', () => {
    const files = readdirSync(mirror);
    for (const core of ['pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
      expect(files, `mirror missing core file ${core}`).toContain(core);
    }
    for (const prefix of REQUIRED_WHEEL_PREFIXES) {
      expect(files.some((f) => f.startsWith(prefix) && f.endsWith('.whl')), `mirror missing ${prefix}*.whl`).toBe(true);
    }
    expect(basename(pyicareWheelPath())).toBe(PYICARE_WHEEL_FILENAME);
    expect(files).toContain(PYICARE_WHEEL_FILENAME);
  });

  test('offline:true without an indexURL is rejected before any boot', async () => {
    await expect(loadICARE({ offline: true })).rejects.toThrow(/indexURL/i);
  });

  test('offline:true without a pyicareWheelUrl is rejected', async () => {
    await expect(loadICARE({ offline: true, indexURL: `${mirror}/` })).rejects.toThrow(
      /pyicareWheelUrl/i,
    );
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
