import { leafIds, type PaneNode } from "@/modules/terminal/lib/panes";
import { toast } from "sonner";

// Below the renderer pool's soft cap, so one tab's panes never compete with
// each other for a slot.
export const MAX_PANES_PER_TAB = 4;

export function splitCapReached(tree: PaneNode): boolean {
  return leafIds(tree).length >= MAX_PANES_PER_TAB;
}

const SPLIT_CAP_TOAST_ID = "terra-split-cap";

/** One toast however often the chord repeats, rather than a stack. */
export function announceSplitCap(): void {
  toast.info(`A tab holds at most ${MAX_PANES_PER_TAB} panes`, {
    id: SPLIT_CAP_TOAST_ID,
    description: "Close a pane or open a new tab to split further.",
  });
}
