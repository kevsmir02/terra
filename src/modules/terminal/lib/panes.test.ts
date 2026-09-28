import { describe, expect, it } from "vitest";
import {
  firstLeafSlotId,
  leafIds,
  removeLeaf,
  setSplitSizes,
  splitLeaf,
  splitSizes,
  swapLeafInDirection,
  type PaneNode,
  validSizes,
} from "@/modules/terminal/lib/panes";

function row(...ids: number[]): PaneNode {
  return {
    kind: "split",
    id: 100,
    dir: "row",
    children: ids.map((id) => ({ kind: "leaf", id })),
  };
}

function col(...ids: number[]): PaneNode {
  return {
    kind: "split",
    id: 200,
    dir: "col",
    children: ids.map((id) => ({ kind: "leaf", id })),
  };
}

describe("swapLeafInDirection", () => {
  it("swaps the active pane with its neighbor to the left", () => {
    expect(leafIds(swapLeafInDirection(row(1, 2, 3), 2, "left"))).toEqual([
      2, 1, 3,
    ]);
  });

  it("wraps right from the rightmost pane to the leftmost pane", () => {
    expect(leafIds(swapLeafInDirection(row(1, 2, 3), 3, "right"))).toEqual([
      3, 2, 1,
    ]);
  });

  it("swaps vertically and wraps upward", () => {
    expect(leafIds(swapLeafInDirection(col(1, 2, 3), 2, "down"))).toEqual([
      1, 3, 2,
    ]);
    expect(leafIds(swapLeafInDirection(col(1, 2, 3), 1, "up"))).toEqual([
      3, 2, 1,
    ]);
  });

  it("chooses the overlapping directional neighbor in a nested layout", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 1 },
        {
          kind: "split",
          id: 11,
          dir: "col",
          children: [
            { kind: "leaf", id: 2 },
            { kind: "leaf", id: 3 },
          ],
        },
      ],
    };

    expect(leafIds(swapLeafInDirection(tree, 2, "down"))).toEqual([1, 3, 2]);
    expect(leafIds(swapLeafInDirection(tree, 3, "left"))).toEqual([3, 2, 1]);
  });

  it("uses live pane bounds after splitters are resized", () => {
    const bounds = [
      { id: 1, left: 0, right: 100, top: 0, bottom: 100 },
      { id: 2, left: 200, right: 300, top: 100, bottom: 200 },
      { id: 3, left: 100, right: 200, top: 0, bottom: 100 },
    ];

    expect(
      leafIds(swapLeafInDirection(row(1, 2, 3), 1, "right", bounds)),
    ).toEqual([3, 2, 1]);
  });

  it("falls back to tree geometry when live bounds are incomplete", () => {
    const tree = row(1, 2, 3);
    const incompleteBounds = [
      { id: 1, left: 0, right: 100, top: 0, bottom: 100 },
    ];

    expect(
      leafIds(swapLeafInDirection(tree, 1, "right", incompleteBounds)),
    ).toEqual([2, 1, 3]);
  });

  it("moves pane metadata with the terminal session", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 100,
      dir: "row",
      children: [
        { kind: "leaf", id: 1, cwd: "/one" },
        { kind: "leaf", id: 2, cwd: "/two" },
      ],
    };
    const swapped = swapLeafInDirection(tree, 2, "left");
    expect(swapped.kind).toBe("split");
    if (swapped.kind === "split") {
      expect(swapped.children[0]).toEqual({
        kind: "leaf",
        id: 2,
        slotId: 1,
        cwd: "/two",
      });
      expect(swapped.children[1]).toEqual({
        kind: "leaf",
        id: 1,
        slotId: 2,
        cwd: "/one",
      });
    }
  });

  it("keeps resizable layout slots fixed while sessions move", () => {
    const tree = row(1, 2, 3);
    const swapped = swapLeafInDirection(tree, 2, "left");

    expect(swapped.kind).toBe("split");
    if (swapped.kind === "split") {
      expect(swapped.children.map(firstLeafSlotId)).toEqual([1, 2, 3]);
      expect(leafIds(swapped)).toEqual([2, 1, 3]);
    }

    const restored = swapLeafInDirection(swapped, 2, "right");
    expect(restored.kind).toBe("split");
    if (restored.kind === "split") {
      expect(restored.children.map(firstLeafSlotId)).toEqual([1, 2, 3]);
      expect(leafIds(restored)).toEqual([1, 2, 3]);
    }
  });

  it("does nothing when the tree contains only one pane", () => {
    const tree: PaneNode = { kind: "leaf", id: 1 };
    expect(swapLeafInDirection(tree, 1, "left")).toBe(tree);
  });
});

function sized(
  dir: "row" | "col",
  sizes: number[] | undefined,
  ...ids: number[]
) {
  return {
    kind: "split" as const,
    id: 300,
    dir,
    children: ids.map((id) => ({ kind: "leaf" as const, id })),
    ...(sizes && { sizes }),
  };
}

function sharesOf(node: PaneNode | null): number[] {
  if (node?.kind !== "split") throw new Error("expected a split");
  return splitSizes(node).map((v) => Math.round(v * 100) / 100);
}

describe("validSizes", () => {
  it("refuses shares that cannot describe the children", () => {
    expect(validSizes([50, 50], 3)).toBeNull();
    expect(validSizes([100], 1)).toBeNull();
    expect(validSizes([60, -10, 50], 3)).toBeNull();
    expect(validSizes([50, 0], 2)).toBeNull();
    expect(validSizes([50, Number.NaN], 2)).toBeNull();
    expect(validSizes([50, Number.POSITIVE_INFINITY], 2)).toBeNull();
    expect(validSizes(["50", "50"], 2)).toBeNull();
    expect(validSizes({ 0: 50, 1: 50, length: 2 }, 2)).toBeNull();
    expect(validSizes(null, 2)).toBeNull();
  });

  it("refuses a total that is not 100, rather than stretching it", () => {
    expect(validSizes([1, 1], 2)).toBeNull();
    expect(validSizes([90, 90], 2)).toBeNull();
  });

  it("absorbs float drift so the shares sum to exactly 100", () => {
    const out = validSizes([33.3, 33.3, 33.3], 3);
    expect(out).not.toBeNull();
    expect(out?.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });
});

describe("splitSizes", () => {
  it("falls back to equal shares when stored sizes are bad", () => {
    expect(sharesOf(sized("row", [10, 10], 1, 2))).toEqual([50, 50]);
    expect(sharesOf(sized("row", [70, 30], 1, 2, 3))).toEqual([
      33.33, 33.33, 33.33,
    ]);
  });
});

describe("setSplitSizes", () => {
  it("records a drag on the addressed split only", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 1,
      dir: "row",
      children: [{ kind: "leaf", id: 2 }, sized("col", undefined, 3, 4)],
    };
    const next = setSplitSizes(tree, 300, [25, 75]);
    expect(next).not.toBe(tree);
    if (next.kind !== "split") throw new Error("expected split");
    expect(next.sizes).toBeUndefined();
    expect(sharesOf(next.children[1])).toEqual([25, 75]);
  });

  it("returns the same tree for a no-op, bad sizes or an unknown split", () => {
    const tree = sized("row", [30, 70], 1, 2);
    expect(setSplitSizes(tree, 300, [30.01, 69.99])).toBe(tree);
    expect(setSplitSizes(tree, 300, [30, 70, 10])).toBe(tree);
    expect(setSplitSizes(tree, 300, [-30, 130])).toBe(tree);
    expect(setSplitSizes(tree, 999, [50, 50])).toBe(tree);
  });
});

describe("split and close keep sizes coherent", () => {
  it("a new sibling takes half of the pane it split", () => {
    const next = splitLeaf(sized("row", [20, 80], 1, 2), 2, 9, 10, "row");
    expect(leafIds(next)).toEqual([1, 2, 10]);
    expect(sharesOf(next)).toEqual([20, 40, 40]);
  });

  it("an unsized split stays equal as it grows", () => {
    const next = splitLeaf(sized("row", undefined, 1, 2), 1, 9, 10, "row");
    expect(sharesOf(next)).toEqual([33.33, 33.33, 33.33]);
  });

  it("closing a pane keeps the survivors' proportions and a valid total", () => {
    const next = removeLeaf(sized("row", [20, 30, 50], 1, 2, 3), 2);
    expect(sharesOf(next)).toEqual([28.57, 71.43]);
    if (next?.kind !== "split") throw new Error("expected split");
    expect(validSizes(next.sizes, next.children.length)).not.toBeNull();
  });

  it("closing down to one pane drops the split and its sizes", () => {
    expect(removeLeaf(sized("row", [20, 80], 1, 2), 1)).toEqual({
      kind: "leaf",
      id: 2,
    });
  });

  it("swapping panes leaves the sizes on their positions", () => {
    const next = swapLeafInDirection(sized("row", [20, 80], 1, 2), 1, "right");
    expect(leafIds(next)).toEqual([2, 1]);
    expect(sharesOf(next)).toEqual([20, 80]);
  });

  it("directional moves follow the real sizes, not an equal split", () => {
    // Below the full-width pane 1, pane 3 covers 90% of the width: it is the
    // pane directly underneath, which an equal split would call a tie.
    const tree: PaneNode = {
      kind: "split",
      id: 1,
      dir: "col",
      children: [
        { kind: "leaf", id: 1 },
        {
          kind: "split",
          id: 2,
          dir: "row",
          sizes: [10, 90],
          children: [
            { kind: "leaf", id: 2 },
            { kind: "leaf", id: 3 },
          ],
        },
      ],
    };
    expect(leafIds(swapLeafInDirection(tree, 1, "down"))).toEqual([3, 2, 1]);
  });
});
