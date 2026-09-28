import { describe, expect, it } from "vitest";
import { isResumableAgent, resumeCommand } from "./resume";

describe("isResumableAgent", () => {
  it("accepts exactly the harnesses with a resume command", () => {
    for (const agent of ["claude", "codex", "opencode"]) {
      expect(isResumableAgent(agent)).toBe(true);
    }
  });

  it("refuses everything else, including inherited object keys", () => {
    for (const value of [
      "gemini",
      "Claude",
      "claude ",
      "toString",
      "constructor",
      "__proto__",
      "",
      null,
      undefined,
      1,
      ["claude"],
    ]) {
      expect(isResumableAgent(value)).toBe(false);
    }
  });
});

describe("resumeCommand", () => {
  it("continues the last conversation for each harness", () => {
    expect(resumeCommand("claude")).toBe("claude --continue");
    expect(resumeCommand("codex")).toBe("codex resume --last");
    expect(resumeCommand("opencode")).toBe("opencode --continue");
  });
});
