import { describe, expect, it } from "vitest";
import {
  applyStatus,
  clusterCounts,
  formatDuration,
  nextWaitingAgent,
  pushRecentRun,
  RECENT_RUNS_MAX,
  runEnding,
  waitingOrder,
} from "./sessions";
import type { AgentSession, AgentStatus, RecentAgentRun } from "./types";

function session(
  leafId: number,
  status: AgentStatus,
  statusSince: number,
  agent = "claude",
): AgentSession {
  return {
    leafId,
    tabId: leafId * 10,
    agent,
    status,
    startedAt: 0,
    statusSince,
    attentionSince: status === "attention" ? statusSince : null,
  };
}

function byLeaf(...list: AgentSession[]): Record<number, AgentSession> {
  return Object.fromEntries(list.map((s) => [s.leafId, s]));
}

describe("applyStatus", () => {
  it("refreshes an ask even when the agent was already asking", () => {
    const asking = session(1, "attention", 100);
    const again = applyStatus(asking, "attention", 500);
    expect(again).not.toBe(asking);
    expect(again.attentionSince).toBe(500);
    expect(again.statusSince).toBe(500);
  });

  it("refreshes an ask that follows a finish", () => {
    const done = applyStatus(session(1, "working", 0), "finished", 100);
    const asked = applyStatus(done, "attention", 200);
    expect(asked.status).toBe("attention");
    expect(asked.attentionSince).toBe(200);
  });

  it("keeps finished apart from attention and leaves a repeat untouched", () => {
    const done = applyStatus(session(1, "working", 0), "finished", 100);
    expect(done.status).toBe("finished");
    expect(applyStatus(done, "finished", 900)).toBe(done);
    const working = session(2, "working", 0);
    expect(applyStatus(working, "working", 900)).toBe(working);
  });

  it("clears the ask when the agent resumes work", () => {
    const back = applyStatus(session(1, "attention", 100), "working", 300);
    expect(back.attentionSince).toBeNull();
    expect(back.statusSince).toBe(300);
  });
});

describe("waitingOrder", () => {
  it("ranks every needs-input above every finished, oldest first within each", () => {
    const order = waitingOrder(
      byLeaf(
        session(1, "finished", 10),
        session(2, "attention", 300),
        session(3, "working", 0),
        session(4, "attention", 200),
        session(5, "finished", 5),
      ),
    );
    expect(order.map((s) => s.leafId)).toEqual([4, 2, 5, 1]);
  });
});

describe("nextWaitingAgent", () => {
  const sessions = byLeaf(
    session(1, "attention", 100),
    session(2, "attention", 200),
    session(3, "finished", 50),
    session(4, "working", 0),
  );

  it("starts at the most urgent agent when focus is elsewhere", () => {
    expect(nextWaitingAgent(sessions, 99)).toEqual({ tabId: 10, leafId: 1 });
    expect(nextWaitingAgent(sessions, null)?.leafId).toBe(1);
    expect(nextWaitingAgent(sessions, 4)?.leafId).toBe(1);
  });

  it("cycles through every waiting agent on repeated presses and wraps", () => {
    const visited: number[] = [];
    let focused: number | null = null;
    for (let i = 0; i < 4; i++) {
      const next = nextWaitingAgent(sessions, focused);
      if (!next) break;
      visited.push(next.leafId);
      focused = next.leafId;
    }
    expect(visited).toEqual([1, 2, 3, 1]);
  });

  it("never returns the focused leaf itself", () => {
    const one = byLeaf(session(7, "attention", 1));
    expect(nextWaitingAgent(one, 7)).toBeNull();
    expect(nextWaitingAgent(one, 8)?.leafId).toBe(7);
  });

  it("returns null when nothing waits", () => {
    expect(nextWaitingAgent({}, null)).toBeNull();
    expect(nextWaitingAgent(byLeaf(session(1, "working", 0)), null)).toBeNull();
  });
});

describe("clusterCounts", () => {
  it("counts per status and names a status held by one agent only", () => {
    const counts = clusterCounts(
      byLeaf(
        session(1, "attention", 0, "codex"),
        session(2, "finished", 0, "claude"),
        session(3, "finished", 0, "opencode"),
      ),
    );
    expect(counts.attention).toEqual({ count: 1, only: "codex" });
    expect(counts.finished).toEqual({ count: 2, only: null });
    expect(counts.working).toEqual({ count: 0, only: null });
  });
});

describe("pushRecentRun", () => {
  it("keeps the newest runs and never grows past the cap", () => {
    let runs: RecentAgentRun[] = [];
    for (let i = 0; i < RECENT_RUNS_MAX + 7; i++) {
      runs = pushRecentRun(runs, {
        id: `r${i}`,
        agent: "claude",
        label: "t",
        tabId: 1,
        leafId: 1,
        startedAt: 0,
        endedAt: i,
        code: 0,
      });
    }
    expect(runs).toHaveLength(RECENT_RUNS_MAX);
    expect(runs[0].id).toBe(`r${RECENT_RUNS_MAX + 6}`);
  });
});

describe("formatDuration", () => {
  it("formats at minute resolution and clamps negatives", () => {
    expect(formatDuration(-5000)).toBe("<1m");
    expect(formatDuration(59_999)).toBe("<1m");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(12 * 60_000 + 59_000)).toBe("12m");
    expect(formatDuration(60 * 60_000)).toBe("1h");
    expect(formatDuration(125 * 60_000)).toBe("2h 5m");
    expect(formatDuration(24 * 3_600_000)).toBe("1d");
    expect(formatDuration(28 * 3_600_000)).toBe("1d 4h");
  });
});

describe("runEnding", () => {
  it("names a clean exit, a failure and an unknown end", () => {
    expect(runEnding(0)).toBe("exited");
    expect(runEnding(130)).toBe("exit 130");
    expect(runEnding(null)).toBe("ended");
  });
});
