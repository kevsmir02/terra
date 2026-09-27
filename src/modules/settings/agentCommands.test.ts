import { describe, expect, it } from "vitest";
import {
  isAgentCommand,
  MAX_AGENT_COMMANDS,
  normalizeAgentCommands,
  parseAgentCommands,
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

describe("parseAgentCommands", () => {
  it("splits on commas and whitespace, dropping built-ins and repeats", () => {
    expect(parseAgentCommands(" gemini, aider  claude\ngemini ")).toEqual({
      accepted: ["gemini", "aider"],
      refused: [],
    });
  });

  it("refuses invalid names and anything past the cap", () => {
    const names = Array.from(
      { length: MAX_AGENT_COMMANDS + 2 },
      (_, i) => `a${i}`,
    );
    const { accepted, refused } = parseAgentCommands(
      `${names.join(",")} ../evil`,
    );
    expect(accepted).toHaveLength(MAX_AGENT_COMMANDS);
    expect(refused).toEqual([
      `a${MAX_AGENT_COMMANDS}`,
      `a${MAX_AGENT_COMMANDS + 1}`,
      "../evil",
    ]);
  });
});

describe("normalizeAgentCommands", () => {
  it("keeps only valid names from whatever the store held", () => {
    expect(normalizeAgentCommands(undefined)).toEqual([]);
    expect(normalizeAgentCommands("gemini")).toEqual([]);
    expect(
      normalizeAgentCommands(["gemini", 3, "a b", "-x", "codex", "gemini"]),
    ).toEqual(["gemini"]);
  });
});
