export type DragHit = {
  /** Path of the tree row under the cursor, if any. */
  fsPath: string | null;
  /** The cursor is inside the explorer's own drop container. */
  insideExplorer: boolean;
  /** Terminal leaf under the cursor, if any. */
  paneLeafId: number | null;
};

export type DropPlan =
  | { kind: "move"; toDir: string }
  | { kind: "terminal"; leafId: number }
  | { kind: "none" };

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

// A release over a terminal pastes the path; the root fallback applies only to
// the explorer's own blank area, so letting go anywhere else moves nothing.
export function planDrop(
  hit: DragHit,
  source: string,
  rootPath: string,
  isDir: (path: string) => boolean | undefined,
): DropPlan {
  if (hit.paneLeafId !== null) return { kind: "terminal", leafId: hit.paneLeafId };
  if (!hit.fsPath && !hit.insideExplorer) return { kind: "none" };
  const target = hit.fsPath
    ? isDir(hit.fsPath)
      ? hit.fsPath
      : parentDir(hit.fsPath)
    : rootPath;
  const valid =
    target !== source &&
    !target.startsWith(`${source}/`) &&
    parentDir(source) !== target;
  return valid ? { kind: "move", toDir: target } : { kind: "none" };
}

export function samePlan(a: DropPlan, b: DropPlan): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "move" && b.kind === "move") return a.toDir === b.toDir;
  if (a.kind === "terminal" && b.kind === "terminal") return a.leafId === b.leafId;
  return true;
}
