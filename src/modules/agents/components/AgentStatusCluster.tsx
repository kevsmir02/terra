import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Notification01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { clusterCounts } from "../lib/sessions";
import { displayAgent } from "../lib/format";
import { useAgentStore } from "../store/agentStore";

const AgentPanel = lazy(() => import("./AgentPanel"));

type Props = {
  onActivate: (tabId: number, leafId: number) => void;
  /** Rendered under a session's row, for actions other modules own. */
  sessionExtra?: (leafId: number, close: () => void) => ReactNode;
};

/**
 * Statusbar cluster: one chip per state, never one per agent, so the zone
 * cannot grow unbounded. Needs-input leads in the warning role, then working,
 * then finished in the ok role; a state held by a single agent names it.
 */
export function AgentStatusCluster({ onActivate, sessionExtra }: Props) {
  const [open, setOpen] = useState(false);
  const sessions = useAgentStore((s) => s.sessions);
  const { attention, working, finished } = useMemo(
    () => clusterCounts(sessions),
    [sessions],
  );
  const idle =
    attention.count === 0 && working.count === 0 && finished.count === 0;

  const attentionLabel =
    attention.count === 1
      ? `${displayAgent(attention.only ?? "")} needs you`
      : `${attention.count} need you`;
  const finishedLabel =
    finished.count === 1
      ? `${displayAgent(finished.only ?? "")} done`
      : `${finished.count} done`;

  const label = idle
    ? "Agent notifications"
    : [
        attention.count > 0 ? attentionLabel : null,
        working.count > 0 ? `${working.count} working` : null,
        finished.count > 0 ? finishedLabel : null,
      ]
        .filter(Boolean)
        .join(", ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          className="terra-label terra-pill-in flex h-4.5 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
        >
          {attention.count > 0 ? (
            <span className="flex items-center gap-1 rounded-sm bg-status-warning/15 px-1.5 text-status-warning">
              <span className="size-1.5 shrink-0 rounded-circle bg-status-warning" />
              {attentionLabel}
            </span>
          ) : null}
          {working.count > 0 ? (
            <span className="flex items-center gap-1 px-0.5">
              <span className="size-1.5 shrink-0 rounded-circle bg-status-renamed" />
              <span className="tabular-nums">{working.count} working</span>
            </span>
          ) : null}
          {finished.count > 0 ? (
            <span className="flex items-center gap-1 px-0.5 text-status-ok">
              <span className="size-1.5 shrink-0 rounded-circle bg-status-ok" />
              <span className="tabular-nums">{finishedLabel}</span>
            </span>
          ) : null}
          {idle ? (
            <HugeiconsIcon
              icon={Notification01Icon}
              size={13}
              strokeWidth={1.75}
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-80 overflow-hidden p-0 gap-0.5"
      >
        <Suspense
          fallback={
            <div className="px-3 py-5 text-center text-xs text-muted-foreground">
              Loading
            </div>
          }
        >
          <AgentPanel
            onActivate={onActivate}
            onClose={() => setOpen(false)}
            sessionExtra={sessionExtra}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
