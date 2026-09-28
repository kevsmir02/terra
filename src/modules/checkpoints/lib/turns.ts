/** The checkpoint a pane's current turn is measured against. */
export type Turn = { repoRoot: string; id: string; at: number };

export type TurnDialogView = "list" | "revert";

export type CheckpointOutcome =
  | { kind: "ready"; repoRoot: string; id: string; reused: boolean }
  | { kind: "not-a-repo" }
  | { kind: "skipped"; repoRoot: string; reason: string };

/** A turn starts when the agent launches and each time it takes a prompt. */
export function isTurnStart(kind: unknown): boolean {
  return kind === "started" || kind === "working";
}

/** The pane's turn after a snapshot attempt. Anything but a fresh or reused
 * checkpoint drops the old one: measuring this turn against an earlier turn's
 * snapshot would show that turn's changes as this one's. */
export function nextTurns(
  turns: Record<number, Turn>,
  leafId: number,
  outcome: CheckpointOutcome | null,
  at: number,
): Record<number, Turn> {
  if (outcome?.kind === "ready") {
    const prev = turns[leafId];
    if (prev && prev.id === outcome.id && prev.repoRoot === outcome.repoRoot)
      return turns;
    return {
      ...turns,
      [leafId]: { repoRoot: outcome.repoRoot, id: outcome.id, at },
    };
  }
  if (!(leafId in turns)) return turns;
  const next = { ...turns };
  delete next[leafId];
  return next;
}

/** Runs one snapshot per pane at a time; a start that lands while one runs
 * folds into a single follow-up, so the last turn is the one recorded. */
export function createPaneQueue(run: (leafId: number) => Promise<void>): {
  request: (leafId: number) => void;
  dispose: () => void;
} {
  const running = new Set<number>();
  const pending = new Set<number>();
  let disposed = false;

  const request = (leafId: number) => {
    if (disposed) return;
    if (running.has(leafId)) {
      pending.add(leafId);
      return;
    }
    running.add(leafId);
    void run(leafId)
      .catch(() => {})
      .finally(() => {
        running.delete(leafId);
        if (pending.delete(leafId)) request(leafId);
      });
  };

  return {
    request,
    dispose: () => {
      disposed = true;
      pending.clear();
    },
  };
}
