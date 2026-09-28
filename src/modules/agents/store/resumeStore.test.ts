import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "./agentStore";
import { offerResume, persistedAgent, useResumeStore } from "./resumeStore";

describe("persistedAgent", () => {
  beforeEach(() => {
    useAgentStore.setState({ sessions: {} });
    useResumeStore.setState({ offers: {} });
  });

  it("persists nothing for a leaf that ran no resumable agent", () => {
    expect(persistedAgent(1)).toBeNull();
    useAgentStore.getState().start(1, 10, "gemini");
    expect(persistedAgent(1)).toBeNull();
  });

  it("prefers the agent running now over an older offer", () => {
    offerResume(1, "claude");
    useAgentStore.getState().start(1, 10, "codex");
    expect(persistedAgent(1)).toBe("codex");
  });

  it("keeps an offer that was never acted on for the next launch", () => {
    offerResume(2, "opencode");
    expect(persistedAgent(2)).toBe("opencode");
    useResumeStore.getState().dismiss(2);
    expect(persistedAgent(2)).toBeNull();
  });
});
