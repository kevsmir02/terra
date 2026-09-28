import type { GitChangedFile } from "@/lib/native";

export type ReviewTarget = {
  path: string;
  mode: "-" | "+";
  originalPath: string | null;
};

/** The file adjacent to `current` in the order the source-control list shows:
 * one row per path, opened as its unstaged side when it has one. From no
 * current file, forward starts at the first row and back at the last. Stops
 * at either end rather than wrapping, so the last file reads as the last. */
export function stepChangedFile(
  files: readonly GitChangedFile[],
  current: { path: string; mode: "-" | "+" } | null,
  dir: 1 | -1,
): ReviewTarget | null {
  const rows: ReviewTarget[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    rows.push({
      path: f.path,
      mode: f.unstaged ? "-" : "+",
      originalPath: f.originalPath,
    });
  }
  if (rows.length === 0) return null;
  const at = current ? rows.findIndex((r) => r.path === current.path) : -1;
  if (at === -1) return dir > 0 ? rows[0] : rows[rows.length - 1];
  return rows[at + dir] ?? null;
}

/** Stepping replaces the tab it starts from only when stepping opened that
 * tab: a preview. A diff the user opened on purpose stays open. */
export function stepReplaces(
  from: { id: number; preview?: boolean } | null,
  openedId: number,
): boolean {
  return !!from?.preview && from.id !== openedId;
}
