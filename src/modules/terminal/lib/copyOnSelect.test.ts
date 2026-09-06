import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  isDragGesture,
  selectionToCopy,
} from "./copyOnSelect";

describe("isDragGesture", () => {
  it("treats a still pointer as a click", () => {
    expect(isDragGesture({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });

  it("treats horizontal movement as a drag", () => {
    // The case the old clientY-only check missed: selecting a filename or a
    // hash inside one line never changes y.
    expect(isDragGesture({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(true);
  });

  it("treats vertical movement as a drag", () => {
    expect(isDragGesture({ x: 10, y: 10 }, { x: 10, y: 40 })).toBe(true);
  });

  it("treats movement in either direction as a drag", () => {
    expect(isDragGesture({ x: 40, y: 40 }, { x: 10, y: 40 })).toBe(true);
    expect(isDragGesture({ x: 40, y: 40 }, { x: 40, y: 10 })).toBe(true);
  });

  it("requires movement to exceed the threshold, not merely reach it", () => {
    const from = { x: 0, y: 0 };
    expect(isDragGesture(from, { x: DRAG_THRESHOLD_PX, y: 0 })).toBe(false);
    expect(isDragGesture(from, { x: DRAG_THRESHOLD_PX + 1, y: 0 })).toBe(true);
  });

  it("does not combine axes into a diagonal distance", () => {
    // 4px on each axis is 5.7px diagonally but is not a drag: each axis is
    // judged on its own, matching the original single-axis check.
    expect(isDragGesture({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
  });

  it("is never a drag without a recorded origin", () => {
    expect(isDragGesture(null, { x: 999, y: 999 })).toBe(false);
  });

  it("honours an explicit threshold", () => {
    expect(isDragGesture({ x: 0, y: 0 }, { x: 8, y: 0 }, 20)).toBe(false);
  });
});

describe("selectionToCopy", () => {
  it("returns the selected text", () => {
    expect(selectionToCopy("src/main.tsx")).toBe("src/main.tsx");
  });

  it("rejects an empty selection", () => {
    expect(selectionToCopy("")).toBeNull();
  });

  it("rejects a whitespace-only selection", () => {
    // Dragging across blank terminal rows yields row padding; replacing the
    // clipboard with spaces is the worst version of this feature.
    expect(selectionToCopy("   \n \t ")).toBeNull();
  });

  it("preserves leading indentation, which is often the point", () => {
    expect(selectionToCopy("    indented")).toBe("    indented");
  });

  it("preserves multi-line content verbatim", () => {
    expect(selectionToCopy("line one\nline two\n")).toBe(
      "line one\nline two\n",
    );
  });
});
