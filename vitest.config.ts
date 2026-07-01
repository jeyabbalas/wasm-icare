import { defineConfig } from 'vitest/config';

// Vitest "projects" (v3.2+): one runner surface, three isolated suites.
// `unit` is Pyodide-free. Real Pyodide boots begin in Phase 2 (the engine smoke
// test under `e2e`); the full compute E2E vs goldens lands in Phase 3. The
// `browser` (Playwright) project is added in Phase 7.

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
          environment: 'node',
          maxWorkers: 1,
          minWorkers: 1,
          hookTimeout: 300_000,
          testTimeout: 120_000,
          passWithNoTests: true,
        },
      },
      {
        plugins: [pyAsText],
        test: {
          name: 'e2e-slow',
          include: ['test/e2e/node/**/*.slow.test.ts'],
          environment: 'node',
          maxWorkers: 1,
          minWorkers: 1,
          hookTimeout: 300_000,
          testTimeout: 120_000,
          passWithNoTests: true,
        },
      },
    ],
  },
});
