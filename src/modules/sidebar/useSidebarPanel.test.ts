import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// react-resizable-panels re-registers a Panel whenever its `defaultSize` prop
// changes identity, and a re-registration mid-drag drops the in-flight drag.
// App re-renders on every resize tick (it persists the sidebar percentage), so
// reading the live width ref there made the divider immovable after one pixel.
describe("sidebar panel sizing", () => {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const hook = readFileSync("src/modules/sidebar/useSidebarPanel.ts", "utf8");

  it("passes the frozen size to the sidebar panel", () => {
    expect(app).toContain("defaultSize={initialSidebarSize}");
  });

  it("never derives defaultSize from the live width ref", () => {
    expect(app).not.toMatch(/defaultSize=\{[^}]*sidebarWidthRef/);
  });

  it("freezes that size at mount", () => {
    expect(hook).toMatch(/const \[initialSidebarSize\] = useState\(/);
  });
});
