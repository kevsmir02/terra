import type { GitLogEntry } from "@/lib/native";

export type FileAtCommit = { path: string; originalPath: string | null };

/**
 * The followed file's name at `entries[index]`. A merge carries no numstat, so
 * its name is borrowed from the nearest newer row that has one (the name
 * before that row's rename) or, failing that, the nearest older row.
 */
export function fileAtCommit(
  entries: readonly GitLogEntry[],
  index: number,
): FileAtCommit | null {
  const own = entries[index];
  if (!own) return null;
  if (own.path) return { path: own.path, originalPath: own.originalPath };
  for (let i = index - 1; i >= 0; i--) {
    const newer = entries[i];
    if (newer.path)
      return { path: newer.originalPath ?? newer.path, originalPath: null };
  }
  for (let i = index + 1; i < entries.length; i++) {
    const older = entries[i].path;
    if (older) return { path: older, originalPath: null };
  }
  return null;
}

function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

/** The directory to resolve the repository from: a file's parent, a
 * directory itself. */
export function historyLookupDir(path: string, isDir: boolean): string {
  const normalized = path.replace(/\\/g, "/");
  return isDir ? normalized.replace(/(.)\/+$/, "$1") : parentDir(normalized);
}
