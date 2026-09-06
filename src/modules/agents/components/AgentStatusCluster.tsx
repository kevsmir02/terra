import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Notification01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useMemo, useState } from "react";
import { displayAgent } from "../lib/format";
import { useAgentStore } from "../store/agentStore";

const AgentPanel = lazy(() => import("./AgentPanel"));

type Props = {
  onActivate: (tabId: number, leafId: number) => void;
};

/**
 * Statusbar cluster: one chip per state, never one per agent, so the zone
 * cannot grow unbounded. A single waiting agent is named; more than one
 * collapses to a count.
 */
export function AgentStatusCluster({ onActivate }: Props) {
  const [open, setOpen] = useState(false);
  const sessions = useAgentStore((s) => s.sessions);
  const notifications = useAgentStore((s) => s.notifications);
  const markAllRead = useAgentStore((s) => s.markAllRead);

  const active = useMemo(() => Object.values(sessions), [sessions]);
  const waitingCount = active.filter((s) => s.status === "waiting").length;
  const workingCount = active.length - waitingCount;
  // attention maps to an active waiting session, so only completed events add
  // to the badge to avoid double-counting.
  const unreadDone = notifications.filter(
    (n) => !n.read && n.kind !== "attention",
  ).length;
  const idle = waitingCount === 0 && workingCount === 0 && unreadDone === 0;

  const waitingLabel =
    waitingCount === 1
      ? `${displayAgent(
          active.find((s) => s.status === "waiting")?.agent ?? "",
        )} needs you`
      : `${waitingCount} need you`;

  const label = idle
    ? "Agent notifications"
    : [
        waitingCount > 0 ? waitingLabel : null,
        workingCount > 0 ? `${workingCount} working` : null,
        unreadDone > 0 ? `${unreadDone} done` : null,
      ]
        .filter(Boolean)
        .join(", ");

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) markAllRead();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          className="terra-label terra-pill-in flex h-4.5 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
        >
          {waitingCount > 0 ? (
            <span className="flex items-center gap-1 rounded-sm bg-status-warning/15 px-1.5 text-status-warning">
              <span className="size-1.5 shrink-0 rounded-circle bg-status-warning" />
              {waitingLabel}
            </span>
          ) : null}
          {workingCount > 0 ? (
            <span className="flex items-center gap-1 px-0.5">
              <span className="size-1.5 shrink-0 rounded-circle bg-primary" />
              <span className="tabular-nums">{workingCount} working</span>
            </span>
          ) : null}
          {unreadDone > 0 ? (
            <span className="flex items-center gap-1 px-0.5 text-status-ok">
              <span className="size-1.5 shrink-0 rounded-circle bg-status-ok" />
              <span className="tabular-nums">{unreadDone} done</span>
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
          <AgentPanel onActivate={onActivate} onClose={() => setOpen(false)} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
