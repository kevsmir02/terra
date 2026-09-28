import type { PaneNode } from "@/modules/terminal/lib/panes";
import { describe, expect, it } from "vitest";
import { MAX_PANES_PER_TAB, splitCapReached } from "./splitCap";

function row(count: number): PaneNode {
  if (count === 1) return { kind: "leaf", id: 1 };
  return {
    kind: "split",
    id: 100,
    dir: "row",
    children: Array.from({ length: count }, (_, i) => ({
      kind: "leaf" as const,
      id: i + 1,
    })),
  };
}

describe("splitCapReached", () => {
  it("allows the split that makes the last permitted pane", () => {
    expect(splitCapReached(row(MAX_PANES_PER_TAB - 1))).toBe(false);
  });

  it("refuses a split once the tab holds the cap", () => {
    expect(splitCapReached(row(MAX_PANES_PER_TAB))).toBe(true);
    expect(splitCapReached(row(MAX_PANES_PER_TAB + 1))).toBe(true);
  });
});
