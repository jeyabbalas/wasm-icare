import { defineConfig } from 'tsup';

// ESM-only: Pyodide 314.x ships as native ES modules.
// The three entries share one config; Node-only imports (`pyodide`, `node:*`)
// live behind `index.node.ts`, so the neutral/browser bundles stay clean.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'index.node': 'src/index.node.ts',
    'index.browser': 'src/index.browser.ts',
    // The browser module-worker entry, emitted as a sibling `dist/worker.js` so
    // `new URL('./worker.js', import.meta.url)` resolves it at runtime.
    worker: 'src/worker/worker.ts',
    // The Node worker_threads entry (opt-in `useWorker:true`), emitted as
    // `dist/nodeWorker.js`; carries the Node loader like `index.node.js`.
    nodeWorker: 'src/worker/nodeWorker.ts',
  },
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  esbuildOptions(options) {
    // Inline `import source from '../bridge/bridge.py'` as the file's text, so
    // the resident Python bridge ships embedded in the bundle (no runtime IO).
    options.loader = { ...options.loader, '.py': 'text' };
  },
  // Note: with `platform: 'neutral'` esbuild rewrites the Node built-in imports
  // in index.node.js from `node:fs` → `fs`, etc. That is safe — Node's ESM
  // loader resolves the bare builtin names to core modules and they cannot be
  // shadowed by `node_modules`. These imports live only in index.node.js.
});
