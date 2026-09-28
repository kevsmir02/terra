import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { invalidateRepoDiffs } from "@/modules/editor/lib/diffCache";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  checkpointIpc,
  type TurnChanges,
  type TurnFileStatus,
} from "./lib/checkpointIpc";
import type { Turn, TurnDialogView } from "./lib/turns";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turn: Turn;
  view: TurnDialogView;
  onViewChange: (view: TurnDialogView) => void;
  onOpenDiff: (repoRoot: string, checkpoint: string, path: string) => void;
  onReverted: () => void;
};

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; changes: TurnChanges };

const STATUS: Record<TurnFileStatus, { letter: string; tone: string }> = {
  added: { letter: "A", tone: "text-status-added" },
  modified: { letter: "M", tone: "text-status-modified" },
  deleted: { letter: "D", tone: "text-status-deleted" },
};

const REVERT_VERB: Record<TurnFileStatus, string> = {
  added: "delete",
  modified: "restore",
  deleted: "restore",
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function since(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function TurnChangesDialog({
  open,
  onOpenChange,
  turn,
  view,
  onViewChange,
  onOpenDiff,
  onReverted,
}: Props) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [restoreIndex, setRestoreIndex] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoad({ kind: "loading" });
    setRestoreIndex(false);
    setRevertError(null);
    checkpointIpc
      .changes(turn.repoRoot, turn.id)
      .then((changes) => {
        if (alive) setLoad({ kind: "loaded", changes });
      })
      .catch((err) => {
        if (alive) setLoad({ kind: "error", message: message(err) });
      });
    return () => {
      alive = false;
    };
  }, [open, turn.repoRoot, turn.id]);

  const files = load.kind === "loaded" ? load.changes.files : [];
  const canRestoreIndex =
    load.kind === "loaded" && load.changes.indexRestorable;

  const revert = async () => {
    setReverting(true);
    setRevertError(null);
    try {
      const out = await checkpointIpc.revert(
        turn.repoRoot,
        turn.id,
        files.map((f) => f.path),
        restoreIndex && canRestoreIndex,
      );
      invalidateRepoDiffs(turn.repoRoot);
      onReverted();
      onOpenChange(false);
      const parts = [
        out.restored ? `${out.restored} restored` : null,
        out.removed ? `${out.removed} removed` : null,
        out.indexRestored ? `${out.indexRestored} unstaged` : null,
      ].filter(Boolean);
      toast.success("Turn reverted", { description: parts.join(", ") });
    } catch (err) {
      setRevertError(message(err));
    } finally {
      setReverting(false);
    }
  };

  const confirming = view === "revert";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {confirming ? "Revert this turn" : "Changes this turn"}
          </DialogTitle>
          <DialogDescription>
            {confirming
              ? "These files go back to how they were when the turn started. Files the turn created are deleted. Nothing else is touched."
              : `Working tree against the checkpoint taken when the turn started, ${since(turn.at)}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 min-h-16 overflow-y-auto rounded-md border border-border/(--emph-strong)">
          {load.kind === "loading" ? (
            <div className="flex h-16 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Comparing with the checkpoint
            </div>
          ) : load.kind === "error" ? (
            <div
              role="alert"
              className="px-3 py-4 text-center text-xs text-destructive"
            >
              {load.message}
            </div>
          ) : files.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              Nothing has changed since the turn started.
            </div>
          ) : (
            <ul className="p-1">
              {files.map((f) => {
                const s = STATUS[f.status];
                const row = (
                  <>
                    <span
                      className={cn(
                        "w-3 shrink-0 font-mono text-[11px]",
                        s.tone,
                      )}
                    >
                      {s.letter}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                      {f.path}
                    </span>
                    {confirming ? (
                      <span className="shrink-0 text-[10.5px] text-muted-foreground">
                        {REVERT_VERB[f.status]}
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <li key={f.path}>
                    {confirming ? (
                      <div className="flex items-center gap-2 px-2 py-1">
                        {row}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenDiff(turn.repoRoot, turn.id, f.path);
                          onOpenChange(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        {row}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {confirming && canRestoreIndex && files.length > 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              id="turn-restore-index"
              checked={restoreIndex}
              onCheckedChange={(v) => setRestoreIndex(v === true)}
            />
            <label htmlFor="turn-restore-index">
              Also put back what was staged for these files
            </label>
          </div>
        ) : null}
        {revertError ? (
          <div role="alert" className="text-xs text-destructive">
            {revertError}
          </div>
        ) : null}

        <DialogFooter>
          {confirming ? (
            <>
              <Button
                variant="ghost"
                onClick={() => onViewChange("list")}
                disabled={reverting}
                autoFocus
              >
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => void revert()}
                disabled={reverting || files.length === 0}
              >
                {reverting ? <Spinner className="size-3" /> : null}
                Revert {files.length} {files.length === 1 ? "file" : "files"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                variant="destructive"
                onClick={() => onViewChange("revert")}
                disabled={files.length === 0}
              >
                Revert turn
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
