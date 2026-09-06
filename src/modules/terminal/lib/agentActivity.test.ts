import { beforeEach, describe, expect, it } from "vitest";
import {
  phaseForSignal,
  selectTabAgentStatus,
  tabAgentStatus,
  useAgentActivityStore,
} from "./agentActivity";

describe("phaseForSignal", () => {
  it("maps lifecycle kinds to phases", () => {
    expect(phaseForSignal("started")).toBe("working");
    expect(phaseForSignal("working")).toBe("working");
    expect(phaseForSignal("attention")).toBe("attention");
    expect(phaseForSignal("finished")).toBe("finished");
    expect(phaseForSignal("exited")).toBe("exited");
  });

  it("ignores unknown kinds", () => {
    expect(phaseForSignal("bogus")).toBeNull();
    expect(phaseForSignal("")).toBeNull();
  });
});

describe("tabAgentStatus", () => {
  it("returns null state for no matching ptys", () => {
    expect(tabAgentStatus({}, {}, [])).toEqual({ state: null, agent: null });
    expect(tabAgentStatus({ 1: "idle" }, {}, [1])).toEqual({
      state: null,
      agent: null,
    });
  });

  it("orders attention > working > finished", () => {
    const phases = { 1: "working", 2: "finished", 3: "attention" } as const;
    expect(tabAgentStatus(phases, {}, [1, 2, 3])).toEqual({
      state: "attention",
      agent: null,
    });
    expect(tabAgentStatus({ 1: "working", 2: "finished" }, {}, [1, 2])).toEqual(
      {
        state: "working",
        agent: null,
      },
    );
    expect(tabAgentStatus({ 1: "finished" }, {}, [1])).toEqual({
      state: "finished",
      agent: null,
    });
  });

  it("surfaces the working agent name for its icon", () => {
    const phases = { 7: "working" } as const;
    expect(tabAgentStatus(phases, { 7: "claude" }, [7])).toEqual({
      state: "working",
      agent: "claude",
    });
  });

  it("only considers the given ptyIds", () => {
    const phases = { 1: "attention", 2: "working" } as const;
    expect(tabAgentStatus(phases, { 2: "codex" }, [2])).toEqual({
      state: "working",
      agent: "codex",
    });
  });
});

describe("useAgentActivityStore", () => {
  beforeEach(() => useAgentActivityStore.setState({ phases: {}, agents: {} }));

  it("keeps a stable reference when the phase is unchanged", () => {
    const { setPhase } = useAgentActivityStore.getState();
    setPhase(1, "working");
    const first = useAgentActivityStore.getState().phases;
    setPhase(1, "working");
    // No churn on repeated identical signals, so subscribers do not re-render.
    expect(useAgentActivityStore.getState().phases).toBe(first);
  });

  it("drops a pty's phase and agent on clear", () => {
    const { setPhase, setAgent, clear } = useAgentActivityStore.getState();
    setPhase(1, "attention");
    setAgent(1, "gemini");
    clear(1);
    const state = useAgentActivityStore.getState();
    expect(1 in state.phases).toBe(false);
    expect(1 in state.agents).toBe(false);
  });
});

describe("selectTabAgentStatus", () => {
  beforeEach(() => useAgentActivityStore.setState({ phases: {}, agents: {} }));

  it("holds a tab's status steady when another tab's pty signals", () => {
    const { setPhase, setAgent } = useAgentActivityStore.getState();
    setPhase(1, "working");
    setAgent(1, "claude");
    const select = selectTabAgentStatus([1]);
    const before = select(useAgentActivityStore.getState());

    setPhase(2, "attention");
    setAgent(2, "codex");
    const after = select(useAgentActivityStore.getState());

    // A fresh object every call by design; `useShallow` compares the two
    // fields, and equal fields are what keeps every other tab's icon from
    // re-rendering on a signal that is not its own.
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });

  it("moves when the tab's own pty signals", () => {
    const { setPhase } = useAgentActivityStore.getState();
    setPhase(1, "working");
    const select = selectTabAgentStatus([1]);
    const before = select(useAgentActivityStore.getState());
    setPhase(1, "attention");
    expect(select(useAgentActivityStore.getState())).not.toEqual(before);
  });
});
