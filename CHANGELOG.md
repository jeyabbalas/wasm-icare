# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [2.1.0] - 2026-07-08

### Changed

- **Raised the minimum Node.js runtime from 18 to 20** (`engines.node` `>=20`). Node 18 reached
  end-of-life in April 2025, and the test runner (vitest 4) no longer supports it. The CI matrix now
  covers Node 20, 22, and 24.
- Bumped the optional `apache-arrow` peer to `^21`. The Arrow input path is unchanged — tables still
  cross to Python as IPC-stream bytes via the dynamically imported, optional dependency.
- Development toolchain: vitest 4, `@vitest/browser` 4, and `@types/node` 26.

### Notes

- A TypeScript 7 bump is deferred until the `tsup` / `rollup-plugin-dts` toolchain supports its
  rewritten compiler API; Dependabot is configured to skip that major until then.

## [2.0.0]

A ground-up rewrite of wasm-icare as a TypeScript/ESM SDK for
[py-icare](https://github.com/jeyabbalas/py-icare) `1.3.0`, running first-class in **both Node.js and
the browser** on a pinned Pyodide `314.0.2` (Python 3.14) snapshot. This is a breaking change from the
v1 browser script — see [Migrating from v1](./README.md#migrating-from-v1).

### Added

- **Node.js support** alongside the browser, from a single npm package with conditional `exports` and
  bundled TypeScript declarations.
- **`buildAbsoluteRiskModel`** — fit a covariate model once (reference dataset read a single time) and
  apply it to many profile batches, including a streaming `applyBatches` for large cohorts.
- **Polymorphic `DataInput`** for every dataset argument: filesystem path, fetchable URL, `File`/`Blob`,
  in-memory columnar typed arrays, array-of-rows, or an `apache-arrow` table — no more URL-only inputs.
- **Typed-array results**: large numeric columns (`risk_estimates`, `linear_predictors`, reference
  risks, validation numerics) are copied once from the WASM heap as `Float64Array`; Categorical columns
  as `{ codes, categories }`.
- **Off-main-thread by default** in the browser (module Web Worker); opt-in `worker_threads` in Node.
  Result buffers are transferred, not structured-clone-copied.
- **Offline / self-hosting**: `offline` + `indexURL` + `pyicareWheelUrl` options (honored in Node and
  the browser), and a **`wasm-icare-vendor`** CLI (`npx wasm-icare-vendor <dir>`) that produces a
  self-contained Pyodide mirror (core runtime + scientific wheels + pyicare wheel, sha256-verified).
- New validation metrics surfaced from py-icare 1.3.0: overall **Brier score** and per-category **E/O
  ratios**.
- A vendored, pinned runtime snapshot (Pyodide 314.0.2 + `pyicare 1.3.0` wheel) for reproducible,
  network-free operation.

### Changed

- **camelCase API** (`computeAbsoluteRisk`, `computeAbsoluteRiskSplitInterval`,
  `validateAbsoluteRiskModel`) taking a single options object; loaded via **`loadICARE()`**.
- Parameters are passed to Python as real objects (no source-string interpolation), fixing v1 defaulting
  bugs (e.g. `seed` now defaults to py-icare's `None` rather than a hardcoded value).
- **ESM-only** distribution (`"type": "module"`), matching Pyodide 314.x.

### Removed

- The v1 `loadWasmICARE()` entry, snake_case methods, and the single hand-written
  `dist/wasm-icare.js` browser file. The v1 git tag and its CDN path remain available for existing
  deployments.
