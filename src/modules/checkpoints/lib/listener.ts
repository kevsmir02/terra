import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useTurnStore } from "../store";
import { type CheckpointOutcome, createPaneQueue, isTurnStart } from "./turns";

type Signal = { id?: unknown; kind?: unknown };

/** Live only while checkpoints are enabled: one agent-signal listener that
 * snapshots a pane's repo when its agent starts a turn, and nothing else. */
export function startCheckpoints(
  cwdForLeaf: (leafId: number) => string | undefined,
  leafIdForPty: (ptyId: number) => number | null,
): () => void {
  const skippedRepos = new Set<string>();
  let stopped = false;
  let unlisten: (() => void) | null = null;
  const queue = createPaneQueue(async (leafId) => {
    const cwd = cwdForLeaf(leafId);
    if (!cwd) return;
    let outcome: CheckpointOutcome | null = null;
    try {
      outcome = await invoke<CheckpointOutcome>("git_checkpoint_create", {
        cwd,
        pane: leafId,
      });
    } catch {
      outcome = null;
    }
    if (stopped) return;
    useTurnStore.getState().record(leafId, outcome);
    if (outcome?.kind === "skipped" && !skippedRepos.has(outcome.repoRoot)) {
      skippedRepos.add(outcome.repoRoot);
      toast("Turn checkpoint skipped", {
        description: `${outcome.reason}. Changes this turn is unavailable for this repo until it fits.`,
      });
    }
  });

  listen<Signal>("terra:agent-signal", (e) => {
    const { id, kind } = e.payload ?? {};
    if (!isTurnStart(kind) || typeof id !== "number") return;
    const leafId = leafIdForPty(id);
    if (leafId !== null) queue.request(leafId);
  })
    .then((u) => {
      if (stopped) u();
      else unlisten = u;
    })
    .catch(() => {});

  return () => {
    stopped = true;
    queue.dispose();
    unlisten?.();
    useTurnStore.getState().clear();
  };
}
