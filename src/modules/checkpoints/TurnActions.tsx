import { useTurnStore } from "./store";

type Props = {
  leafId: number;
  onOpen: (leafId: number, revert: boolean) => void;
};

/** The agent panel's entry points for a pane whose turn has a checkpoint;
 * nothing for a pane outside a repo or with checkpoints off. */
export function TurnActions({ leafId, onOpen }: Props) {
  const turn = useTurnStore((s) => s.turns[leafId]);
  if (!turn) return null;
  const link =
    "rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none";
  return (
    <div className="flex items-center gap-1 pl-8">
      <button
        type="button"
        className={link}
        onClick={() => onOpen(leafId, false)}
      >
        Changes this turn
      </button>
      <button
        type="button"
        className={link}
        onClick={() => onOpen(leafId, true)}
      >
        Revert turn
      </button>
    </div>
  );
}
