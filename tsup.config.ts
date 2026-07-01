import { defineConfig } from 'tsup';

// ESM-only: Pyodide 314.x ships as native ES modules.
// Env-conditional entries are wired to real bootstraps in later phases;
// in Phase 0 the .node/.browser entries simply re-export the shared surface.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'index.node': 'src/index.node.ts',
    'index.browser': 'src/index.browser.ts',
  },
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
