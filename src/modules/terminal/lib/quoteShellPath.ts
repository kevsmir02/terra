// Quote only when needed, so a clean path stays verbatim for bracketed paste
// (Claude resolves an image path to "[Image #N]"); spaced/special paths quote.
const SAFE_PATH = /^[A-Za-z0-9_@%+=:,./\\-]+$/;

export function quoteShellPath(p: string): string {
  if (SAFE_PATH.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

// A path under the pane's cwd pastes as its tail so it stays short for the
// shell and for CLI agents; anything else, and a tail that would read as a
// flag, stays absolute.
export function relativeToCwd(path: string, cwd: string | undefined): string {
  if (!cwd) return path;
  const base = cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
  if (path === base) return ".";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (!path.startsWith(prefix)) return path;
  const tail = path.slice(prefix.length);
  return tail.startsWith("-") ? path : tail;
}

export function formatDroppedPaths(paths: string[], cwd?: string): string {
  return `${paths.map((p) => quoteShellPath(relativeToCwd(p, cwd))).join(" ")} `;
}
