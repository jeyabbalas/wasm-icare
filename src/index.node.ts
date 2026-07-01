/**
 * Node.js entry. In Phase 2 this wires the bundled Pyodide snapshot
 * (`import { loadPyodide } from 'pyodide'`) + NODEFS mounts into `loadICARE`.
 * For now it re-exports the shared surface.
 */
export * from './index';
