import { defineConfig } from 'vitest/config';

// Vitest "projects" (v3.2+): one runner surface, three isolated suites.
// Phase 0 only populates `unit`; `e2e` / `e2e-slow` are scaffolds that boot
// real Pyodide starting in Phase 3. The `browser` (Playwright) project is
// added in Phase 7 so Phase 0 needs no browser deps.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
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
