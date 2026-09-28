import type { GitBlameCommit } from "@/lib/native";

const UNITS: [number, string][] = [
  [365 * 24 * 3600, "year"],
  [30 * 24 * 3600, "month"],
  [7 * 24 * 3600, "week"],
  [24 * 3600, "day"],
  [3600, "hour"],
  [60, "minute"],
];

export function relativeTime(secs: number, nowSecs: number): string {
  const delta = Math.max(0, nowSecs - secs);
  for (const [size, unit] of UNITS) {
    const n = Math.floor(delta / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

export const NOT_COMMITTED = "Not committed yet";

export type BlameStatus =
  | "loading"
  | "ready"
  | "untracked"
  | "tooLarge"
  | "notInRepo"
  | "dirty"
  | "error";

const STATUS_TEXT: Record<Exclude<BlameStatus, "ready">, string> = {
  loading: "Loading blame...",
  untracked: NOT_COMMITTED,
  tooLarge: "Blame is off for files over 4 MB",
  notInRepo: "Not in a git repository",
  dirty: "Save to load blame",
  error: "Blame failed",
};

/** The annotation for one line: its commit, or the state that stands in for
 * one. A line with no commit in a ready blame was edited since the blame. */
export function annotationText(
  status: BlameStatus,
  commit: GitBlameCommit | null,
  nowSecs: number,
): string {
  if (commit) {
    if (commit.uncommitted) return NOT_COMMITTED;
    const who = commit.author || "Unknown";
    const summary = commit.summary ? ` · ${commit.summary}` : "";
    return `${who}, ${relativeTime(commit.authorTime, nowSecs)}${summary} · ${commit.shortSha}`;
  }
  return status === "ready" ? NOT_COMMITTED : STATUS_TEXT[status];
}

/** What a commit's file diff tab needs: the name the file had in that commit,
 * and the parent-side name when the commit renamed it. */
export function commitFileTarget(
  commit: GitBlameCommit,
): { path: string; originalPath: string | null } | null {
  if (commit.uncommitted || !commit.filename) return null;
  const renamed =
    commit.previousFilename && commit.previousFilename !== commit.filename
      ? commit.previousFilename
      : null;
  return { path: commit.filename, originalPath: renamed };
}
