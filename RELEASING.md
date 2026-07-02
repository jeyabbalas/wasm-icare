# Releasing wasm-icare

This is a maintainer-facing guide. It is **not** shipped to npm (the `files` allowlist in
`package.json` excludes it).

`wasm-icare` publishes to npm via **Trusted Publishing (OIDC)** — GitHub Actions authenticates
to npm with a short-lived, workflow-scoped credential and attaches build **provenance**
automatically. There is no long-lived `NPM_TOKEN` anywhere.

Because a Trusted Publisher can only be configured on a package that already exists, the **first
release is published manually**; every release afterward is automated by `.github/workflows/publish.yml`.

---

## What CI runs

`.github/workflows/ci.yml` (on push to `main`, PRs, nightly, and manual dispatch):

- **checks** — Node 18/20/22: `typecheck`, `build`, `test:unit`, `verify-fixtures`.
- **package** — publish gates: `publint`, `attw`, `check-package` (tarball allowlist + 80 KB
  bundle gate), `smoke-tarball` (packs, installs into a scratch project, imports it).
- **e2e** — Node 20: real Pyodide, the fast BPC3 + iCARE-Lit specs vs the R-derived goldens.
- **browser** — Node 20: the same path through headless Chromium (Playwright), self-hosting Pyodide.
- **e2e-slow** — nightly / manual only: the slow validation + build-once + `worker_threads` specs.

`.github/workflows/publish.yml` runs a fast preflight (`typecheck`, `build`, `test:unit`,
`check-package`), verifies the version matches the release tag, then `npm publish`.

---

## One-time setup (first release, ~2.0.0)

**Prerequisites**

- The GitHub repo `jeyabbalas/wasm-icare` is **public** (required to generate provenance).
- You are logged in to [npmjs.com](https://www.npmjs.com/) as the account that owns `jeyabbalas`,
  with 2FA enabled.

**1. Publish the first version manually**

```sh
git switch main && git pull          # clean tree at the version you're releasing (2.0.0)
npm ci
npm run build
npm run check-package                # sanity: tarball contents + size gate
npm publish --dry-run                # inspect exactly what will ship
npm login                            # as the account owning `jeyabbalas`
npm publish                          # unscoped ⇒ public automatically
```

A local publish has **no provenance** — that is expected. Every automated (OIDC) publish
afterward includes it.

**2. Configure the Trusted Publisher on npmjs.com**

npmjs.com → package **wasm-icare** → **Settings** → **Trusted Publisher** → add a GitHub
Actions publisher:

| Field | Value |
|---|---|
| Organization or user | `jeyabbalas` |
| Repository | `wasm-icare` |
| Workflow filename | `publish.yml` |
| Environment | *(leave blank)* |

The workflow filename must match exactly — if `publish.yml` is renamed, update it here too.

---

## Every release after the first (automated)

1. Bump the version — `npm version <patch|minor|major>` (updates `package.json` **and**
   `package-lock.json` and creates a `vX.Y.Z` commit + tag) — or edit `package.json` +
   `package-lock.json` by hand.
2. Update `CHANGELOG.md`.
3. Push `main` (and the tag if you used `npm version`).
4. Publish a **GitHub Release** with tag `vX.Y.Z`.

The Release fires `publish.yml` → the preflight runs → `npm publish` ships the package to npm
with provenance. No secrets, no manual `npm publish`.

> `npm version` bundles Node 20's npm 10.x, which is fine locally. Only the *workflow* needs
> npm ≥ 11.5.1 for OIDC, and it upgrades itself (`npm install -g npm@latest`).

---

## Version-bump touchpoints

- **`package.json` + `package-lock.json`** — the npm version (`npm version` keeps them in sync).
- **`src/runtime/config.ts` → `PYICARE_WHEEL_CDN_URL`** — pinned to the published **major**
  (`.../npm/wasm-icare@2/...`) so browser CDN default-boots resolve the vendored wheel. Update
  the `@N` only on a **major** bump.
- **The pyicare wheel** (`PYICARE_VERSION` in `src/runtime/config.ts`, the wheel in
  `assets/wheels/`, and the hardcoded assertion in `scripts/smoke-tarball.mjs`) changes **only**
  when the bundled py-icare version changes — regenerate with `npm run vendor-wheel` (needs a
  local `py-icare` checkout), then re-run `npm run check-package` and `npm run smoke-tarball`.
- **Pyodide** (`PYODIDE_VERSION` in `config.ts` and the `pyodide` dependency in `package.json`)
  changes only when upgrading the Pyodide runtime.
