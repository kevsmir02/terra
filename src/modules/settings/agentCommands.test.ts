import { describe, expect, it } from "vitest";
import {
  addAgentCommands,
  isAgentCommand,
  MAX_AGENT_COMMANDS,
  normalizeAgentCommands,
} from "./agentCommands";

describe("isAgentCommand", () => {
  it("accepts plain command names", () => {
    for (const ok of ["gemini", "cursor-agent", "qwen", "aider.v2", "a_b"]) {
      expect(isAgentCommand(ok)).toBe(true);
    }
    expect(isAgentCommand("a".repeat(32))).toBe(true);
  });

  it("refuses paths, flags, shell syntax and oversize names", () => {
    for (const bad of [
      "",
      "-rf",
      ".x",
      "_x",
      "a b",
      "a/b",
      "a;b",
      "$(x)",
      "a\u0007",
      "été",
      "a".repeat(33),
    ]) {
      expect(isAgentCommand(bad)).toBe(false);
    }
  });
});

describe("addAgentCommands", () => {
  it("skips built-ins and repeats without refusing them", () => {
    const refused: string[] = [];
    expect(
      addAgentCommands(["gemini"], ["aider", "claude", "gemini", ""], refused),
    ).toEqual(["gemini", "aider"]);
    expect(refused).toEqual([]);
  });

  it("refuses invalid names and anything past the cap", () => {
    const names = Array.from(
      { length: MAX_AGENT_COMMANDS + 2 },
      (_, i) => `a${i}`,
    );
    const refused: string[] = [];
    const out = addAgentCommands([], [...names, "../evil"], refused);
    expect(out).toHaveLength(MAX_AGENT_COMMANDS);
    expect(refused).toEqual([
      `a${MAX_AGENT_COMMANDS}`,
      `a${MAX_AGENT_COMMANDS + 1}`,
      "../evil",
    ]);
  });

  it("never mutates the list it starts from", () => {
    const start = ["gemini"];
    addAgentCommands(start, ["aider"]);
    expect(start).toEqual(["gemini"]);
  });
});

describe("normalizeAgentCommands", () => {
  it("keeps only valid names from whatever the store held", () => {
    expect(normalizeAgentCommands(undefined)).toEqual([]);
    expect(normalizeAgentCommands("gemini")).toEqual([]);
    expect(normalizeAgentCommands({ 0: "gemini" })).toEqual([]);
    expect(
      normalizeAgentCommands(["gemini", 3, "a b", "-x", "codex", "gemini"]),
    ).toEqual(["gemini"]);
  });
});
