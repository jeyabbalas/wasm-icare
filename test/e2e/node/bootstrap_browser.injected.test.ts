import { resolve } from 'node:path';
import process from 'node:process';

import { loadPyodide } from 'pyodide';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createICARE } from '../../../src/api/icareFacade';
import type { ICARE } from '../../../src/api/types';
import { createNodeMaterializer } from '../../../src/io/materialize-node';
import { pyicareWheelPath, pyodideIndexPath } from '../../../src/runtime/assets-node';
import { bootstrapBrowserEngine } from '../../../src/runtime/bootstrap-browser';
import type { Engine } from '../../../src/runtime/engine';
import { createInProcessClient } from '../../../src/worker/transport';
import { assertAllClose } from '../../helpers/assert';
import { bpc3 } from '../../helpers/fixtures';
import { loadGolden } from '../../helpers/goldens';
import { ATOL_DETERMINISTIC } from '../../helpers/tolerances';

/**
 * Phase 7 — the browser bootstrap's load sequence, exercised OFFLINE in Node. We
 * inject the installed `pyodide` package's `loadPyodide` (pointing indexURL at
 * `node_modules/pyodide` and the wheel at the vendored path), so
 * `bootstrapBrowserEngine` runs its real loadPackage → wheel → createEngine → bridge
 * path against a real runtime — everything the browser does except the dynamic
 * `import('…/pyodide.mjs')` + `fetch` (both proven by the Playwright spec). Host
 * `{ path }` inputs use the Node materializer (the browser materializer is covered
 * in the browser spec).
 */

interface CovariateGolden {
  age_start: number;
  age_interval_length: number;
  risks: number[];
  linear_predictors: number[];
}

describe('browser bootstrap sequence (injected Pyodide, Node)', () => {
  let engine: Engine;
  let icare: ICARE;

  beforeAll(async () => {
    const packageCacheDir = resolve(process.cwd(), '.pyodide-cache');
    engine = await bootstrapBrowserEngine(
      { indexURL: pyodideIndexPath(), pyicareWheelUrl: pyicareWheelPath() },
      {
        importPyodide: async () => ({
          loadPyodide: (config) => loadPyodide({ ...config, packageCacheDir }),
        }),
      },
    );
    const client = createInProcessClient(engine);
    icare = createICARE(client, createNodeMaterializer(client));
  });

  afterAll(async () => {
    await icare?.close();
  });

  test('the wheel loaded and a BPC3 compute matches the golden', async () => {
    expect(engine.icareVersion()).toBe('1.3.0');

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
