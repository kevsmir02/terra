import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  Notification03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { AgentIcon } from "../lib/agentIcon";
import { displayAgent } from "../lib/format";
import type { AgentNotification, AgentStatus } from "../lib/types";
import { useAgentStore } from "../store/agentStore";

type Props = {
  onActivate: (tabId: number, leafId: number) => void;
  onClose: () => void;
};

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusRow({
  agent,
  status,
  onClick,
}: {
  agent: string;
  status: AgentStatus;
  onClick: () => void;
}) {
  const waiting = status === "waiting";
  return (
    <button
      type="button"
      onClick={onClick}
      className="terra-row-in terra-motion flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <AgentIcon
        agent={agent}
        size={16}
        className="shrink-0 text-muted-foreground"
      />
      <span className="flex-1 truncate text-sm text-foreground">
        {displayAgent(agent)}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs",
          waiting ? "font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {waiting ? (
          <span className="size-1.5 rounded-circle bg-primary" />
        ) : null}
        {waiting ? "waiting" : "working"}
      </span>
    </button>
  );
}

const NOTIF_LABEL: Record<AgentNotification["kind"], string> = {
  attention: "needs input",
  finished: "finished",
  error: "failed",
};

const HOOK_AGENTS = ["claude", "codex"] as const;

function HookAgentRow({
  id,
  label,
  ready,
  installing,
  onEnable,
}: {
  id: string;
  label: string;
  ready: boolean;
  installing: boolean;
  onEnable: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <AgentIcon
        agent={id}
        size={14}
        className="shrink-0 text-muted-foreground"
      />
      <span className="flex-1 truncate text-[12px] text-muted-foreground">
        {label}
      </span>
      {ready ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={13}
            strokeWidth={1.75}
          />
          enabled
        </span>
      ) : (
        <button
          type="button"
          onClick={onEnable}
          disabled={installing}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
        >
          {installing ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={12}
              strokeWidth={1.75}
              className="animate-spin"
            />
          ) : null}
          {installing ? "Enabling" : "Enable"}
        </button>
      )}
    </div>
  );
}

function NotificationRow({
  n,
  onClick,
}: {
  n: AgentNotification;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {n.kind === "finished" ? (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={15}
            strokeWidth={1.75}
            className="text-muted-foreground"
          />
        ) : (
          <span
            className={cn(
              "size-1.5 rounded-circle",
              n.kind === "error" ? "bg-destructive" : "bg-primary",
            )}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {displayAgent(n.agent)}{" "}
        <span className="text-muted-foreground">{NOTIF_LABEL[n.kind]}</span>
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {relativeTime(n.at)}
      </span>
    </button>
  );
}

/**
 * The cluster's management surface. Lazy on purpose: the hook installer, the
 * notification list and their icons are worth nothing until someone opens the
 * popover, and the statusbar chip reads the store on its own.
 */
export default function AgentPanel({ onActivate, onClose }: Props) {
  const [hooks, setHooks] = useState<Record<string, boolean>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const sessions = useAgentStore((s) => s.sessions);
  const notifications = useAgentStore((s) => s.notifications);
  const clearNotifications = useAgentStore((s) => s.clearNotifications);

  const active = useMemo(() => Object.values(sessions), [sessions]);
  const activeCount = active.length;
  const enabledCount = HOOK_AGENTS.filter((id) => hooks[id] === true).length;

  useEffect(() => {
    let alive = true;
    for (const id of HOOK_AGENTS) {
      invoke<boolean>("agent_hooks_status", { agent: id })
        .then((ok) => {
          if (alive) setHooks((h) => ({ ...h, [id]: ok }));
        })
        .catch(() => {
          if (alive) setHooks((h) => ({ ...h, [id]: false }));
        });
    }
    return () => {
      alive = false;
    };
  }, []);

  const enableHooks = async (id: string) => {
    setInstalling(id);
    try {
      await invoke("agent_enable_hooks", { agent: id });
      setHooks((h) => ({ ...h, [id]: true }));
    } catch {
      setHooks((h) => ({ ...h, [id]: false }));
    } finally {
      setInstalling(null);
    }
  };

  const activate = (tabId: number, leafId: number) => {
    onActivate(tabId, leafId);
    onClose();
  };

  const empty = activeCount === 0 && notifications.length === 0;

  return (
    <>
      <div className="flex h-10 items-center gap-2 px-3 pt-0.5">
        <span className="flex gap-1 text-[13px] text-foreground">
          Notifications
        </span>
        <div className="ml-auto flex items-center gap-2">
          {activeCount > 0 ? (
            <span className="rounded-pill bg-accent px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {activeCount} active
            </span>
          ) : null}
          {notifications.length > 0 ? (
            <button
              type="button"
              onClick={clearNotifications}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {empty ? (
        <div className="border-t border-border/(--emph-strong) px-3 py-5 text-center text-xs leading-relaxed text-muted-foreground">
          No agent activity yet.
          <br />
          Run a coding agent to track it here.
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto border-t border-border/(--emph-strong) p-1">
          {active.map((s) => (
            <StatusRow
              key={s.leafId}
              agent={s.agent}
              status={s.status}
              onClick={() => activate(s.tabId, s.leafId)}
            />
          ))}
          {activeCount > 0 && notifications.length > 0 ? (
            <div className="mx-2 my-1 h-0 border-t border-border/(--emph-medium)" />
          ) : null}
          {notifications.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onClick={() => activate(n.tabId, n.leafId)}
            />
          ))}
        </div>
      )}

      <div className="border-t border-border/(--emph-strong) p-1">
        <button
          type="button"
          onClick={() => setAlertsOpen((v) => !v)}
          aria-expanded={alertsOpen}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium terra-label text-muted-foreground/(--emph-strong) transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={Notification03Icon} size={11} strokeWidth={2} />
          Agent alerts
          <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">
            {enabledCount > 0 ? (
              <span className="text-[10px] text-muted-foreground/(--emph-strong)">
                {enabledCount} on
              </span>
            ) : null}
            <HugeiconsIcon
              icon={alertsOpen ? ArrowUp01Icon : ArrowDown01Icon}
              size={13}
              strokeWidth={2}
            />
          </span>
        </button>
        {alertsOpen
          ? HOOK_AGENTS.map((id) => (
              <HookAgentRow
                key={id}
                id={id}
                label={displayAgent(id)}
                ready={hooks[id] === true}
                installing={installing === id}
                onEnable={() => enableHooks(id)}
              />
            ))
          : null}
      </div>
    </>
  );
}
