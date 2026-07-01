/**
 * Ambient declaration so `import source from './bridge.py'` resolves to the
 * file's text as a string. The text is inlined at build time by the esbuild
 * `.py` text loader (tsup) and the `py-as-text` Vite plugin (vitest) — there is
 * no runtime `fs`/`fetch`, so the engine that imports it stays env-neutral.
 */
declare module '*.py' {
  const source: string;
  export default source;
}
