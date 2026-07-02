# Wasm-iCARE

<p align="center">
<img src="./images/wasm-icare-logo.png" style="width: 40%;">
</p>

A TypeScript/JavaScript SDK for [iCARE](https://github.com/jeyabbalas/py-icare) (Individualized
Coherent Absolute Risk Estimation) — build, validate, and apply absolute risk models in **Node.js and
the browser**, with no Python installation. It runs the `py-icare` package inside
[Pyodide](https://pyodide.org/) (CPython on WebAssembly); a fixed, pinned runtime snapshot ships with
the package for reproducible, offline-capable results.

> **v2 is a ground-up rewrite** (TypeScript, ESM, Node + browser, camelCase API, typed-array results,
> off-main-thread by default). Upgrading from the v1 browser script? See
> [Migrating from v1](#migrating-from-v1).

- **Runtime:** Pyodide `314.0.2` (Python 3.14) with numpy 2.4.3 / pandas 3.0.2 / scipy 1.18.0 /
  patsy 1.0.2, and `pyicare 1.3.0`.
- **Module format:** ESM only (`"type": "module"`), with bundled TypeScript declarations.

## Installation

```sh
npm install wasm-icare
```

The `pyodide` runtime is a dependency and installs with it. `apache-arrow` is an *optional* dependency —
install it only to pass Arrow tables as input.

## Quick start (Node)

```js
import { loadICARE } from 'wasm-icare';

const icare = await loadICARE();

const result = await icare.computeAbsoluteRisk({
  applyAgeStart: 50,
  applyAgeIntervalLength: 5,
  modelDiseaseIncidenceRates: { path: 'data/incidence_rates.csv' },
  modelCovariateFormula: '~ famhist + as.factor(parity)', // inline Patsy formula
  modelLogRelativeRisk: { famhist: 0.68, 'as.factor(parity)[T.2]': -0.31 }, // inline log-ORs
  modelReferenceDataset: { path: 'data/reference.csv' },
  applyCovariateProfile: { path: 'data/profile.csv' },
  returnLinearPredictors: true,
});

// Big numeric columns come back as typed arrays (zero-copy from the WASM heap):
console.log(result.profile.columns.risk_estimates); // Float64Array
console.log(result.profile.columns.linear_predictors); // Float64Array
console.log(result.model); // { feature: beta, … } fitted log relative-risks

await icare.close(); // release the runtime (and any worker)
```

Every method is `async`. Call `close()` when you're done to free the Pyodide runtime.

## The API

`loadICARE()` returns an `ICARE` handle with four methods.

### `computeAbsoluteRisk(options)`

Build and apply an absolute risk model (covariate-only, SNP-only, or combined). Returns
`{ model, profile, referenceRisks?, method }`, where `profile` is a columnar result (see
[Results](#results)). Common options:

| Option | Type | Notes |
|---|---|---|
| `applyAgeStart`, `applyAgeIntervalLength` | `number \| number[]` | Scalar (all subjects) or per-subject |
| `modelDiseaseIncidenceRates` | `TabularInput` | Required |
| `modelCompetingIncidenceRates` | `TabularInput` | Optional competing-risk rates |
| `modelCovariateFormula` | `FormulaInput` | Patsy formula (inline string or file) |
| `modelLogRelativeRisk` | `LogOddsRatiosInput` | `{ name: logOR }` or JSON file |
| `modelReferenceDataset` | `TabularInput` | Reference covariate distribution |
| `modelSnpInfo`, `applySnpProfile`, `modelFamilyHistoryVariableName` | — | SNP workflows |
| `applyCovariateProfile` | `TabularInput` | Subjects to score |
| `returnLinearPredictors`, `returnReferenceRisks` | `boolean` | Include extra outputs |
| `seed` | `number` | Reproducible SNP imputation |

### `computeAbsoluteRiskSplitInterval(options)`

Relaxes the proportional-hazards assumption by allowing distinct model parameters before/after a
`cutpoint` in age. Takes `…BeforeCutpoint` / `…AfterCutpoint` variants of the model/profile arguments
and returns `{ model, profile, referenceRisks?, method }`.

### `validateAbsoluteRiskModel(options)`

Validate a model against independent cohort or nested case-control study data. Returns AUC, Brier
score, overall and per-category E/O ratios, and Hosmer-Lemeshow calibration:

```js
const v = await icare.validateAbsoluteRiskModel({
  studyData: { path: 'data/study.csv' },
  predictedRiskInterval: 'total-followup',
  icareModelParameters: {
    modelDiseaseIncidenceRates: { path: 'data/incidence_rates.csv' },
    modelCovariateFormula: '~ famhist',
    modelLogRelativeRisk: { famhist: 0.68 },
    modelReferenceDataset: { path: 'data/reference.csv' },
  },
});
console.log(v.auc, v.brierScore, v.expectedByObservedRatio, v.calibration);
```

### `buildAbsoluteRiskModel(options)` — fit once, apply many

For scoring large or streamed cohorts, fit the model **once** (the reference dataset is read a single
time) and apply it to many profile batches. Covariate models only.

```js
const model = await icare.buildAbsoluteRiskModel({
  modelDiseaseIncidenceRates: { path: 'data/incidence_rates.csv' },
  modelCovariateFormula: '~ famhist',
  modelLogRelativeRisk: { famhist: 0.68 },
  modelReferenceDataset: { path: 'data/reference.csv' },
});

// One-shot apply:
const r = await model.apply({
  applyAgeStart: 50,
  applyAgeIntervalLength: 5,
  applyCovariateProfile: { path: 'data/profile.csv' },
});

// Or stream a large table in chunks — peak memory stays ≈ one batch:
for await (const batch of model.applyBatches(
  { columns: { famhist: bigFamhistFloat64Array } },
  { applyAgeStart: 50, applyAgeIntervalLength: 5, batchRows: 100_000, returnLinearPredictors: true },
)) {
  batch.riskEstimates; // Float64Array for this chunk
}

await model.free(); // release the resident model
```

## Data inputs

Every dataset argument accepts a `DataInput` — pick whichever avoids an extra copy:

| Form | Example | Environment |
|---|---|---|
| Filesystem path | `{ path: 'data/x.csv' }` | Node |
| Fetchable URL | `{ url: 'https://…/x.csv' }` | Node + browser |
| `File` / `Blob` | a browser `File` from an `<input>` | browser |
| Columnar (typed arrays) | `{ columns: { age: Float64Array.from([…]), sex: ['M','F'] } }` | Node + browser |
| Array of rows | `[{ age: 50, sex: 'M' }, …]` | Node + browser (least efficient) |
| Arrow table | an `apache-arrow` `Table` (needs `loadICARE({ packages: ['pyarrow'] })`) | Node + browser |

Per-argument bare forms: a **formula** may be an inline string (`'~ famhist'`); **log relative risks**
may be an inline object (`{ famhist: 0.68 }`).

## Results

Numeric columns are returned as **typed arrays** copied once from the WASM heap; small metadata comes
back as plain objects. A columnar result is `{ columns, order, nRows }`:

```js
result.profile.columns.risk_estimates; // Float64Array
result.profile.columns.linear_predictors; // Float64Array (if requested)
result.profile.order; // string[] — original column order
result.profile.nRows; // number
```

pandas Categorical columns arrive as `{ codes: Int32Array, categories: string[] }` (compact at scale).

## Browser usage

The browser runs the engine in a **module Web Worker by default** (`useWorker: true`), keeping Pyodide
off the main thread. Result buffers are transferred (not copied) back to the caller.

### Zero-setup (CDN)

```html
<script type="module">
  import { loadICARE } from 'https://esm.sh/wasm-icare@2';
  const icare = await loadICARE(); // Pyodide loads from the pinned jsDelivr CDN
  // …
</script>
```

### Self-hosting / offline

Vendor a self-contained Pyodide mirror next to your app, then point `loadICARE` at it. Nothing is
fetched from a CDN at runtime.

```sh
npx wasm-icare-vendor ./public/pyodide
```

```js
import { loadICARE } from 'wasm-icare';

const icare = await loadICARE({
  indexURL: '/pyodide/',
  pyicareWheelUrl: '/pyodide/pyicare-1.3.0-py3-none-any.whl',
  offline: true, // no CDN fallback; both URLs required
});
```

`wasm-icare-vendor <dir> [--packages pyarrow]` copies the pinned Pyodide runtime, the scientific
wheels, and the pyicare wheel into `<dir>`, each verified against `pyodide-lock.json`.

Offline works in Node too — pass `indexURL` (a filesystem path to the mirror) + `pyicareWheelUrl` +
`offline: true`. By default Node loads the runtime from `node_modules/pyodide` and downloads the
scientific wheels once (cached under `.pyodide-cache`).

## `loadICARE` options

| Option | Default | Description |
|---|---|---|
| `indexURL` | pinned CDN (browser) / `node_modules/pyodide` (Node) | Base URL/path of a self-hosted Pyodide distribution |
| `pyicareWheelUrl` | vendored wheel | Override the pyicare wheel location |
| `offline` | `false` | Require self-hosted assets; disables the CDN fallback (needs `indexURL` + `pyicareWheelUrl`) |
| `packages` | `[]` | Extra Pyodide packages (e.g. `['pyarrow']`) |
| `useWorker` | `true` (browser) / `false` (Node) | Run the engine in a worker |
| `workerUrl` | built worker entry | Custom worker script URL |

The browser worker entry is also exported at `wasm-icare/worker`.

## Quarto

**Server-side (Node, in-process Pyodide — no Python on the R side).** Put the computation in a small
ES module and run it from a code chunk during render:

````markdown
```{bash}
node compute.mjs > results.json
```
````

```js
// compute.mjs
import { loadICARE } from 'wasm-icare';
const icare = await loadICARE();
const r = await icare.computeAbsoluteRisk({ /* … */ });
process.stdout.write(JSON.stringify({ risks: [...r.profile.columns.risk_estimates] }));
await icare.close();
```

**In the browser (OJS from CDN).** An `{ojs}` cell runs Pyodide client-side:

````markdown
```{ojs}
icare = (await import('https://esm.sh/wasm-icare@2')).loadICARE()
result = icare.then(i => i.computeAbsoluteRisk({ /* … */ }))
```
````

## Migrating from v1

v1 was a single browser-only ES6 file loaded from a GitHub CDN. v2 is an npm package (Node + browser).

| v1 | v2 |
|---|---|
| `loadWasmICARE()` from `cdn.jsdelivr.net/gh/…/wasm-icare.js` | `loadICARE()` from `wasm-icare` (npm) or `esm.sh`/jsDelivr npm |
| `icare.compute_absolute_risk(...)` (snake_case) | `icare.computeAbsoluteRisk(...)` (camelCase) |
| all params as fetchable URLs | `DataInput` union: path / URL / File / Blob / columns / rows / Arrow |
| positional/URL-only arguments | a single camelCase options object per method |
| results as JSON strings | typed-array columns + plain-object metadata |
| runs on the main thread | module Web Worker by default (browser) |

The v1 git tag and its CDN path remain available for existing deployments.

## Demonstration

iCARE-Lit, a literature-based breast-cancer absolute risk model, is deployed as a web application here:
https://github.com/jeyabbalas/icare-lit. (v1 usage notebooks are on
[ObservableHQ](https://observablehq.com/collection/@jeyabbalas/wasm-icare).)

## License

Wasm-iCARE is open-source licensed under the MIT License.

## References

1. [Balasubramanian JB, Choudhury PP, Mukhopadhyay S, Ahearn T, Chatterjee N, García-Closas M, Almeida JS. Wasm-iCARE: a portable and privacy-preserving web module to build, validate, and apply absolute risk models. JAMIA open. 2024 Apr 8;7(2).](https://pubmed.ncbi.nlm.nih.gov/38938691/)
