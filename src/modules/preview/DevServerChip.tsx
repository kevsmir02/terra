import { cn } from "@/lib/utils";
import { Cancel01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  chipLabel,
  openDevServer,
  useDevServerStore,
} from "./lib/devServerStore";

/** Offers the dev-server URL detected in this pane's output. Anchored to the
 * pane rather than the window so multiple panes can each hold their own offer.
 * Persists until dismissed, clicked, or superseded, no auto-expiry, since a
 * chip that vanishes on a timer is one the user misses while reading. */
export function DevServerChip({ leafId }: { leafId: number }) {
  const url = useDevServerStore((s) => s.byLeaf[leafId]?.candidate ?? null);
  const dismiss = useDevServerStore((s) => s.dismiss);
  if (!url) return null;
  return (
    <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-pill border border-border/(--emph-strong)",
          "bg-background/(--emph-bold) py-1 pr-1 pl-2.5 text-xs shadow-lg backdrop-blur-sm",
        )}
      >
        <button
          type="button"
          onClick={() => openDevServer(leafId)}
          className="terra-label flex items-center gap-1.5 font-medium text-foreground"
        >
          <HugeiconsIcon
            icon={Globe02Icon}
            size={14}
            strokeWidth={1.75}
            className="text-primary"
          />
          <span>Preview {chipLabel(url)}</span>
        </button>
        <button
          type="button"
          onClick={() => dismiss(leafId)}
          aria-label="Dismiss dev server preview"
          className="grid size-5 place-items-center rounded-pill text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
