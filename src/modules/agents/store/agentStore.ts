import { create } from "zustand";
import { applyStatus, nextWaitingAgent, pushRecentRun } from "../lib/sessions";
import type {
  AgentNotification,
  AgentSession,
  AgentStatus,
  RecentAgentRun,
} from "../lib/types";

const MAX_NOTIFICATIONS = 50;

let notifSeq = 0;
let runSeq = 0;

type AgentStoreState = {
  sessions: Record<number, AgentSession>;
  notifications: AgentNotification[];
  recent: RecentAgentRun[];
  start: (leafId: number, tabId: number, agent: string) => void;
  setStatus: (leafId: number, status: AgentStatus) => void;
  finish: (leafId: number, end: { label: string; code: number | null }) => void;
  pushNotification: (n: Omit<AgentNotification, "id" | "at">) => void;
  clearHistory: () => void;
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},
  notifications: [],
  recent: [],

  start: (leafId, tabId, agent) =>
    set((s) => {
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            leafId,
            tabId,
            agent,
            status: "working",
            startedAt: now,
            statusSince: now,
            attentionSince: null,
          },
        },
      };
    }),

  setStatus: (leafId, status) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev) return s;
      const next = applyStatus(prev, status, Date.now());
      if (next === prev) return s;
      return { sessions: { ...s.sessions, [leafId]: next } };
    }),

  finish: (leafId, { label, code }) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev) return s;
      const sessions = { ...s.sessions };
      delete sessions[leafId];
      const run: RecentAgentRun = {
        id: `r${++runSeq}`,
        agent: prev.agent,
        label,
        tabId: prev.tabId,
        leafId,
        startedAt: prev.startedAt,
        endedAt: Date.now(),
        code,
      };
      return { sessions, recent: pushRecentRun(s.recent, run) };
    }),

  pushNotification: (n) =>
    set((s) => ({
      notifications: [
        { ...n, id: `n${++notifSeq}`, at: Date.now() },
        ...s.notifications,
      ].slice(0, MAX_NOTIFICATIONS),
    })),

  clearHistory: () => set({ notifications: [], recent: [] }),
}));

/** The next waiting agent after the focused leaf, for the jump shortcut. */
export function nextAttentionTarget(focusedLeafId: number | null): {
  tabId: number;
  leafId: number;
} | null {
  return nextWaitingAgent(useAgentStore.getState().sessions, focusedLeafId);
}
