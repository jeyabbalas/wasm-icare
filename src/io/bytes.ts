/**
 * Small byte / filename helpers shared by the input-materialization paths.
 * Env-neutral (no `node:*` / DOM APIs).
 */

/** Last path segment, tolerating both `/` and `\` separators and trailing ones. */
export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Reduce an arbitrary input name to a safe Pyodide FS filename — no path
 * separators can escape the input directory, and only readable characters
 * survive. Falls back to `input` for an empty result.
 */
export function sanitizeFsName(name: string): string {
  const safe = basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.length > 0 ? safe : 'input';
}
