import type { AgentSession, AgentStatus, RecentAgentRun } from "./types";

export const RECENT_RUNS_MAX = 20;

/**
 * The session after a status signal, or the same object when nothing changed.
 * An ask always refreshes its timestamps: a second question after the first was
 * answered in the agent's own UI is new, and must sort and notify as new.
 */
export function applyStatus(
  prev: AgentSession,
  status: AgentStatus,
  now: number,
): AgentSession {
  if (status === "attention") {
    return { ...prev, status, statusSince: now, attentionSince: now };
  }
  if (prev.status === status) return prev;
  return {
    ...prev,
    status,
    statusSince: now,
    attentionSince: status === "working" ? null : prev.attentionSince,
  };
}

const RANK: Record<AgentStatus, number> = {
  attention: 0,
  finished: 1,
  working: 2,
};

/** Agents waiting on the user, most urgent first: every needs-input before any
 * finished, and the one that has waited longest first within each. */
export function waitingOrder(
  sessions: Record<number, AgentSession>,
): AgentSession[] {
  return Object.values(sessions)
    .filter((s) => s.status !== "working")
    .sort(
      (a, b) =>
        RANK[a.status] - RANK[b.status] ||
        a.statusSince - b.statusSince ||
        a.leafId - b.leafId,
    );
}

/**
 * Where the jump-to-agent shortcut goes next. Stateless: it steps past the
 * focused leaf in `waitingOrder`, so pressing again after a jump lands on the
 * following agent and the presses walk the whole list, wrapping at the end.
 */
export function nextWaitingAgent(
  sessions: Record<number, AgentSession>,
  focusedLeafId: number | null,
): { tabId: number; leafId: number } | null {
  const order = waitingOrder(sessions);
  const at = order.findIndex((s) => s.leafId === focusedLeafId);
  const next =
    at < 0
      ? order[0]
      : order.length > 1
        ? order[(at + 1) % order.length]
        : null;
  return next ? { tabId: next.tabId, leafId: next.leafId } : null;
}

type StatusCount = { count: number; only: string | null };

/** Per-status counts for the statusbar, with the agent named when one alone
 * holds a status. */
export function clusterCounts(
  sessions: Record<number, AgentSession>,
): Record<AgentStatus, StatusCount> {
  const out: Record<AgentStatus, StatusCount> = {
    attention: { count: 0, only: null },
    working: { count: 0, only: null },
    finished: { count: 0, only: null },
  };
  for (const s of Object.values(sessions)) {
    const c = out[s.status];
    c.count += 1;
    c.only = c.count === 1 ? s.agent : null;
  }
  return out;
}

/** Newest first, capped, so the list stays bounded however long Terra runs. */
export function pushRecentRun(
  runs: RecentAgentRun[],
  run: RecentAgentRun,
): RecentAgentRun[] {
  return [run, ...runs].slice(0, RECENT_RUNS_MAX);
}

/** "<1m", "12m", "2h 5m", "3d 4h": minute resolution, so a panel repainting
 * every few seconds never shows a number that is about to be wrong. */
export function formatDuration(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function runEnding(code: number | null): string {
  if (code === null) return "ended";
  return code === 0 ? "exited" : `exit ${code}`;
}
