import { describe, expect, it } from "vitest";
import { MIN_COLS, MIN_ROWS, proposeDimensions } from "./fitDimensions";

const CELL = { width: 8, height: 17 };

describe("proposeDimensions", () => {
  it("fills the box", () => {
    expect(proposeDimensions({ width: 800, height: 340 }, CELL)).toEqual({
      cols: 100,
      rows: 20,
    });
  });

  // The bug this function exists to fix: FitAddon reserves overviewRuler.width
  // || 14 for a scrollbar Terra hides, so a full-width TUI lost the rightmost
  // column or two. Anything that reintroduces a gutter fails here.
  it("reserves no gutter for a scrollbar Terra does not render", () => {
    const dims = proposeDimensions({ width: 800, height: 340 }, CELL);
    const withFitAddonGutter = Math.floor((800 - 14) / CELL.width);
    expect(dims?.cols).toBe(100);
    expect(dims?.cols).toBeGreaterThan(withFitAddonGutter);
  });

  it("floors a partial trailing cell rather than overflowing", () => {
    expect(proposeDimensions({ width: 807, height: 349 }, CELL)).toEqual({
      cols: 100,
      rows: 20,
    });
  });

  it("clamps to a usable minimum in a collapsed pane", () => {
    expect(proposeDimensions({ width: 3, height: 4 }, CELL)).toEqual({
      cols: MIN_COLS,
      rows: MIN_ROWS,
    });
  });

  it.each([
    ["unmeasured cell", { width: 800, height: 340 }, { width: 0, height: 0 }],
    ["parked host", { width: 0, height: 0 }, CELL],
    ["detached host", { width: Number.NaN, height: Number.NaN }, CELL],
  ])("returns null for %s rather than a bogus grid", (_name, box, cell) => {
    expect(proposeDimensions(box, cell)).toBeNull();
  });
});
