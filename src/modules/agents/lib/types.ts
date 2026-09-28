/** `attention`: the agent is blocked on the user. `finished`: its turn ended and
 * it sits at its prompt. Distinct because only the first one is urgent. */
export type AgentStatus = "working" | "attention" | "finished";

export type AgentSource = "terminal" | "local";

export type AgentSignalKind =
  | "started"
  | "working"
  | "attention"
  | "finished"
  | "exited";

export type AgentSignal = {
  id: number;
  kind: AgentSignalKind;
  agent: string | null;
  /** Exit status on `exited`, when the shell reported one. */
  code?: number | null;
};

export type AgentSession = {
  leafId: number;
  tabId: number;
  agent: string;
  status: AgentStatus;
  startedAt: number;
  /** When the current status began; what "working 12m" counts from. */
  statusSince: number;
  /** Last time the agent asked for input, refreshed on every ask. */
  attentionSince: number | null;
};

/** An agent run that ended, for the panel's recent list. */
export type RecentAgentRun = {
  id: string;
  agent: string;
  label: string;
  tabId: number;
  leafId: number;
  startedAt: number;
  endedAt: number;
  /** null when the pane closed or the shell reported no status. */
  code: number | null;
};

export type AgentNotification = {
  id: string;
  source: AgentSource;
  leafId: number;
  tabId: number;
  agent: string;
  kind: NotificationKind;
  at: number;
};

export type NotificationKind = "attention" | "finished" | "error";
