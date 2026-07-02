import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Vitest "projects" (v3.2+): one runner surface, four isolated suites.
// `unit` is Pyodide-free; `e2e` / `e2e-slow` boot real Pyodide in Node; `browser`
// runs the worker + in-process paths in a real headless Chromium (Playwright).

// Inline `import source from '*.py'` as the file's text (mirrors the esbuild
// `.py` text loader in tsup.config.ts) so the bridge import resolves in tests.
// NOTE: `projects` do NOT inherit root-level plugins, so this is attached to
// each project config below rather than at the root.
const pyAsText = {
  name: 'py-as-text',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.endsWith('.py')) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

// Serve the browser test's assets from the repo, so the Playwright run self-hosts
// Pyodide (offline). `/pyodide/*` merges the core runtime (node_modules/pyodide)
// with the scientific wheels warmed into `.pyodide-cache` (see warm-cache.setup.ts);
// `/wheels/*` is the vendored pyicare wheel; `/fixtures/*` is the BPC3 test data.
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const ASSET_MOUNTS = [
  { prefix: '/pyodide/', roots: [join(rootDir, 'node_modules/pyodide'), join(rootDir, '.pyodide-cache')] },
  { prefix: '/wheels/', roots: [join(rootDir, 'assets/wheels')] },
  { prefix: '/fixtures/', roots: [join(rootDir, 'test/fixtures')] },
  { prefix: '/golden/', roots: [join(rootDir, 'test/golden')] },
  // The built worker bundle (raw dynamic import, no dev-server transform); the
  // worker spec loads it from here, so `test:browser` builds first.
  { prefix: '/dist/', roots: [join(rootDir, 'dist')] },
];
const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.whl': 'application/octet-stream',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

interface AssetReq {
  url?: string;
}
interface AssetRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}
const serveTestAssets = {
  name: 'serve-test-assets',
  configureServer(server: { middlewares: { use(fn: (req: AssetReq, res: AssetRes, next: () => void) => void): void } }) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0] ?? '';
      const mount = ASSET_MOUNTS.find((m) => url.startsWith(m.prefix));
      if (!mount) return next();
      const rel = decodeURIComponent(url.slice(mount.prefix.length));
      for (const root of mount.roots) {
        const filePath = join(root, rel);
        if (filePath.startsWith(root) && existsSync(filePath) && statSync(filePath).isFile()) {
          res.setHeader('Content-Type', CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream');
          createReadStream(filePath).pipe(res as unknown as NodeJS.WritableStream);
          return;
        }
      }
      res.statusCode = 404;
      res.end(`test asset not found: ${url}`);
    });
  },
};

const NODE_E2E = {
  environment: 'node' as const,
  maxWorkers: 1,
  minWorkers: 1,
  hookTimeout: 300_000,
  testTimeout: 120_000,
  passWithNoTests: true,
  // Warm `.pyodide-cache` once before the Node E2E run (same Node setup the browser
  // project uses) so the offline-mirror spec finds the scientific wheels locally
  // regardless of file order, and every boot skips the first-run CDN download.
  globalSetup: ['test/e2e/browser/warm-cache.setup.ts'],
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [pyAsText],
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [pyAsText],
        test: {
          name: 'e2e',
          include: ['test/e2e/node/**/*.test.ts'],
          exclude: ['test/e2e/node/**/*.slow.test.ts'],
          ...NODE_E2E,
        },
      },
      {
        plugins: [pyAsText],
        test: {
          name: 'e2e-slow',
          include: ['test/e2e/node/**/*.slow.test.ts'],
          ...NODE_E2E,
        },
      },
      {
        plugins: [pyAsText, serveTestAssets],
        test: {
          name: 'browser',
          include: ['test/e2e/browser/**/*.test.ts'],
          // Warm .pyodide-cache in Node first, so the served /pyodide/ mirror has
          // the scientific wheels even on a cold machine.
          globalSetup: ['test/e2e/browser/warm-cache.setup.ts'],
          hookTimeout: 300_000,
          testTimeout: 180_000,
          passWithNoTests: true,
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
