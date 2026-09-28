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
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { AgentIcon } from "../lib/agentIcon";
import { displayAgent } from "../lib/format";
import { formatDuration, runEnding, waitingOrder } from "../lib/sessions";
import type {
  AgentNotification,
  AgentSession,
  AgentStatus,
  RecentAgentRun,
} from "../lib/types";
import { useNow } from "../lib/useNow";
import { useAgentStore } from "../store/agentStore";

type Props = {
  onActivate: (tabId: number, leafId: number) => void;
  onClose: () => void;
  sessionExtra?: (leafId: number, close: () => void) => ReactNode;
};

// Durations show whole minutes, so a coarse tick is exact enough.
const TICK_MS = 15_000;

function relativeTime(ts: number, now: number): string {
  const s = Math.floor((now - ts) / 1000);
  if (s < 60) return "just now";
  return `${formatDuration(now - ts)} ago`;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  attention: "needs input",
  working: "working",
  finished: "done",
};

const STATUS_TONE: Record<AgentStatus, string> = {
  attention: "font-medium text-status-warning",
  working: "text-muted-foreground",
  finished: "text-status-ok",
};

const STATUS_DOT: Record<AgentStatus, string> = {
  attention: "bg-status-warning",
  working: "bg-status-renamed",
  finished: "bg-status-ok",
};

function StatusRow({
  session,
  now,
  onClick,
}: {
  session: AgentSession;
  now: number;
  onClick: () => void;
}) {
  const { agent, status, statusSince } = session;
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
        className={cn("flex items-center gap-1.5 text-xs", STATUS_TONE[status])}
      >
        <span
          className={cn("size-1.5 rounded-circle", STATUS_DOT[status])}
          aria-hidden
        />
        {STATUS_LABEL[status]}
        <span className="tabular-nums text-muted-foreground">
          {formatDuration(now - statusSince)}
        </span>
      </span>
    </button>
  );
}

function RecentRow({
  run,
  now,
  onClick,
}: {
  run: RecentAgentRun;
  now: number;
  onClick: () => void;
}) {
  const failed = run.code !== null && run.code !== 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      <AgentIcon
        agent={run.agent}
        size={14}
        className="shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
        {displayAgent(run.agent)}{" "}
        <span className="text-muted-foreground">{run.label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] tabular-nums text-muted-foreground">
        <span>{formatDuration(run.endedAt - run.startedAt)}</span>
        <span className={cn(failed && "text-destructive")}>
          {runEnding(run.code)}
        </span>
        <span>{relativeTime(run.endedAt, now)}</span>
      </span>
    </button>
  );
}

const NOTIF_LABEL: Record<AgentNotification["kind"], string> = {
  attention: "needs input",
  finished: "finished",
  error: "failed",
};

const HOOK_AGENTS = ["claude", "codex", "opencode"] as const;

function HookAgentRow({
  id,
  label,
  ready,
  installing,
  error,
  onEnable,
}: {
  id: string;
  label: string;
  ready: boolean;
  installing: boolean;
  error: string | null;
  onEnable: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1">
      <div className="flex items-center gap-2">
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
      {error ? (
        <span className="pl-5.5 text-[10.5px] leading-snug text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function NotificationRow({
  n,
  now,
  onClick,
}: {
  n: AgentNotification;
  now: number;
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
            className="text-status-ok"
          />
        ) : (
          <span
            className={cn(
              "size-1.5 rounded-circle",
              n.kind === "error" ? "bg-destructive" : "bg-status-warning",
            )}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {displayAgent(n.agent)}{" "}
        <span className="text-muted-foreground">{NOTIF_LABEL[n.kind]}</span>
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {relativeTime(n.at, now)}
      </span>
    </button>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="terra-label px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/(--emph-strong)">
      {children}
    </div>
  );
}

/**
 * The cluster's management surface. Lazy on purpose: the hook installer, the
 * notification list and their icons are worth nothing until someone opens the
 * popover, and the statusbar chip reads the store on its own. It is mounted
 * only while the popover is open, so its clock ticks only then.
 */
export default function AgentPanel({
  onActivate,
  onClose,
  sessionExtra,
}: Props) {
  const [hooks, setHooks] = useState<Record<string, boolean>>({});
  const [hookErrors, setHookErrors] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const sessions = useAgentStore((s) => s.sessions);
  const notifications = useAgentStore((s) => s.notifications);
  const recent = useAgentStore((s) => s.recent);
  const clearHistory = useAgentStore((s) => s.clearHistory);
  const now = useNow(TICK_MS);

  const active = useMemo(() => {
    const waiting = waitingOrder(sessions);
    const working = Object.values(sessions)
      .filter((s) => s.status === "working")
      .sort((a, b) => a.statusSince - b.statusSince);
    return [...waiting, ...working];
  }, [sessions]);
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
    setHookErrors((errs) => {
      const next = { ...errs };
      delete next[id];
      return next;
    });
    try {
      await invoke("agent_enable_hooks", { agent: id });
      setHooks((h) => ({ ...h, [id]: true }));
    } catch (e) {
      setHooks((h) => ({ ...h, [id]: false }));
      setHookErrors((errs) => ({ ...errs, [id]: String(e) }));
    } finally {
      setInstalling(null);
    }
  };

  const activate = (tabId: number, leafId: number) => {
    onActivate(tabId, leafId);
    onClose();
  };

  const hasHistory = notifications.length > 0 || recent.length > 0;
  const empty = activeCount === 0 && !hasHistory;

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
          {hasHistory ? (
            <button
              type="button"
              onClick={clearHistory}
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
        <div className="max-h-96 overflow-y-auto border-t border-border/(--emph-strong) p-1">
          {active.map((s) => (
            <Fragment key={s.leafId}>
              <StatusRow
                session={s}
                now={now}
                onClick={() => activate(s.tabId, s.leafId)}
              />
              {sessionExtra?.(s.leafId, onClose)}
            </Fragment>
          ))}
          {notifications.length > 0 ? (
            <>
              {activeCount > 0 ? <SectionLabel>Alerts</SectionLabel> : null}
              {notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  now={now}
                  onClick={() => activate(n.tabId, n.leafId)}
                />
              ))}
            </>
          ) : null}
          {recent.length > 0 ? (
            <>
              <SectionLabel>Recent runs</SectionLabel>
              {recent.map((r, i) => (
                <Fragment key={r.id}>
                  <RecentRow
                    run={r}
                    now={now}
                    onClick={() => activate(r.tabId, r.leafId)}
                  />
                  {sessions[r.leafId] ||
                  recent.findIndex((x) => x.leafId === r.leafId) !== i
                    ? null
                    : sessionExtra?.(r.leafId, onClose)}
                </Fragment>
              ))}
            </>
          ) : null}
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
                error={hookErrors[id] ?? null}
                onEnable={() => enableHooks(id)}
              />
            ))
          : null}
      </div>
    </>
  );
}
