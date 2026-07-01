/**
 * Node.js entry. Re-exports the shared surface and wires the Node runtime
 * bootstrap. This is the only published entry that pulls in `pyodide` +
 * `node:*` (bundled into `dist/index.node.js`); the neutral (`index.ts`) and
 * browser (`index.browser.ts`) entries never import it.
 *
 * The public `loadICARE` still throws here — it is wired onto the engine in
 * Phase 3; `bootstrapNodeEngine` is the internal factory used by the Phase 2
 * engine smoke test.
 */
export * from './index';
export { bootstrapNodeEngine, type NodeBootstrapOptions } from './runtime/bootstrap-node';
export type { Engine } from './runtime/engine';
