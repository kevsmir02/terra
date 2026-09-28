import { describe, expect, it } from "vitest";
import {
  broadcastLine,
  broadcastRecipients,
  describeBroadcastTargets,
} from "./broadcast";

const leaf = (leafId: number, alive: boolean, agent: boolean) => ({
  leafId,
  alive,
  agent,
});

describe("broadcastRecipients", () => {
  const panes = [
    leaf(1, true, true),
    leaf(2, true, false),
    leaf(3, false, false),
    leaf(4, true, true),
  ];

  it("sends to every live pane in tree order", () => {
    expect(broadcastRecipients(panes, false)).toEqual([1, 2, 4]);
  });

  it("never sends to a pane whose shell exited", () => {
    expect(broadcastRecipients([leaf(3, false, true)], false)).toEqual([]);
    expect(broadcastRecipients([leaf(3, false, true)], true)).toEqual([]);
  });

  it("keeps only agent panes when asked", () => {
    expect(broadcastRecipients(panes, true)).toEqual([1, 4]);
    expect(broadcastRecipients([leaf(2, true, false)], true)).toEqual([]);
  });
});

describe("broadcastLine", () => {
  it("refuses an empty or blank line", () => {
    expect(broadcastLine("")).toBeNull();
    expect(broadcastLine("   ")).toBeNull();
    expect(broadcastLine("\r\n")).toBeNull();
  });

  it("drops trailing line breaks so Enter is sent exactly once", () => {
    expect(broadcastLine("git status\n")).toBe("git status");
    expect(broadcastLine("git status\r\n\r\n")).toBe("git status");
  });

  it("keeps the line otherwise as typed", () => {
    expect(broadcastLine("  run tests ")).toBe("  run tests ");
  });
});

describe("describeBroadcastTargets", () => {
  it("names the reason nobody takes the line", () => {
    expect(describeBroadcastTargets([], [], false)).toMatch(/not a terminal/);
    expect(
      describeBroadcastTargets([leaf(1, false, false)], [], false),
    ).toMatch(/exited/);
    expect(describeBroadcastTargets([leaf(1, true, false)], [], true)).toMatch(
      /running an agent/,
    );
  });

  it("counts partial delivery against the tab's panes", () => {
    const panes = [leaf(1, true, true), leaf(2, true, false)];
    expect(describeBroadcastTargets(panes, [1], true)).toBe(
      "Sends to 1 of 2 panes, the ones running an agent.",
    );
    expect(describeBroadcastTargets(panes, [1, 2], false)).toBe(
      "Sends to all 2 panes.",
    );
  });
});
