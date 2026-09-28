import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useShortcutLabel } from "@/modules/shortcuts";
import type { HunkAction } from "./lib/hunks";

type Props = {
  mode: "-" | "+";
  index: number;
  total: number;
  busy: boolean;
  error: string | null;
  confirmingDiscard: boolean;
  onPrimary: () => void;
  onDiscard: () => void;
  onConfirmDiscard: () => void;
  onCancelDiscard: () => void;
};

const PRIMARY_LABEL: Record<Exclude<HunkAction, "discard">, string> = {
  stage: "Stage change",
  unstage: "Unstage change",
};

/** Actions on the change the cursor sits in (F7 moves between them). */
export function HunkBar({
  mode,
  index,
  total,
  busy,
  error,
  confirmingDiscard,
  onPrimary,
  onDiscard,
  onConfirmDiscard,
  onCancelDiscard,
}: Props) {
  const stageKey = useShortcutLabel("diff.stageHunk");
  const discardKey = useShortcutLabel("diff.discardHunk");
  const nextKey = useShortcutLabel("diff.nextChange");
  const selected = index >= 0;
  const primary = mode === "-" ? "stage" : "unstage";

  if (confirmingDiscard) {
    return (
      <div
        role="alertdialog"
        aria-label="Discard this change"
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border/(--emph-soft) bg-destructive/(--emph-faint) px-3 text-[11px]"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancelDiscard();
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate text-foreground">
          Discard this change from the working tree? It cannot be undone.
        </span>
        <Button
          size="xs"
          variant="ghost"
          autoFocus
          onClick={onCancelDiscard}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          variant="destructive"
          onClick={onConfirmDiscard}
          disabled={busy}
        >
          {busy ? <Spinner className="size-3" /> : null}
          Discard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/(--emph-soft) px-3 text-[11px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate" role="status">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : total === 0 ? (
          "No changes left in this file"
        ) : selected ? (
          <span className="tabular-nums">
            Change {index + 1} of {total}
          </span>
        ) : (
          <span className="tabular-nums">
            {total} {total === 1 ? "change" : "changes"}. {nextKey} selects one.
          </span>
        )}
      </span>
      {busy ? <Spinner className="size-3" /> : null}
      <Button
        size="xs"
        variant="ghost"
        onClick={onPrimary}
        disabled={!selected || busy}
        title={stageKey ? `${PRIMARY_LABEL[primary]} (${stageKey})` : undefined}
      >
        {PRIMARY_LABEL[primary]}
      </Button>
      {mode === "-" ? (
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive"
          onClick={onDiscard}
          disabled={!selected || busy}
          title={discardKey ? `Discard change (${discardKey})` : undefined}
        >
          Discard
        </Button>
      ) : null}
    </div>
  );
}
