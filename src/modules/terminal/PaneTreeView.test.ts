import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A Panel re-registers whenever its `defaultSize` changes identity, which
// drops a drag in flight (the sidebar gotcha in TERRA.md). Split sizes reach
// the library through the Group's `defaultLayout`, read only on registration.
describe("pane split sizing", () => {
  const view = readFileSync("src/modules/terminal/PaneTreeView.tsx", "utf8");

  it("feeds the tree's sizes through the group, never a panel defaultSize", () => {
    expect(view).toContain("defaultLayout={defaultLayout}");
    expect(view).not.toMatch(/defaultSize=/);
  });

  it("writes dragged sizes back to the tree", () => {
    expect(view).toMatch(/onLayoutChanged=\{/);
    expect(view).toContain("props.onResizeSplit(node.id, sizes)");
  });
});
