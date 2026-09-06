import { PREVIEW_Z, WASH_Z } from "@/modules/theme";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The theme's background-image wash (SurfaceLayer) paints above the app so
 * it's visible through translucent chrome, and the preview pane renders a
 * live external iframe that must stay pixel-accurate, so it paints above the
 * wash. Both live in the root stacking context alongside every Radix portal,
 * so both must stay under the overlay layer, otherwise the preview covers
 * menus, dialogs and toasts opened over it and they appear not to open at all.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "WorkspaceSurface.tsx"), "utf8");
const uiDir = path.resolve(here, "../../components/ui");

// Primitives that portal their content to document.body. Each brings its own
// z-index along, so read it back from the file rather than assuming z-50.
const PORTALLED = [
  "dropdown-menu",
  "context-menu",
  "dialog",
  "alert-dialog",
  "popover",
  "tooltip",
  "select",
];

function overlayZ(file: string): number {
  const text = readFileSync(path.join(uiDir, `${file}.tsx`), "utf8");
  const found = [...text.matchAll(/\bz-(\d+)\b/g)].map((m) => Number(m[1]));
  expect(found.length, `${file} declares no z-index`).toBeGreaterThan(0);
  return Math.max(...found);
}

describe("root stacking order", () => {
  it("paints the preview above the wallpaper wash", () => {
    expect(PREVIEW_Z).toBeGreaterThan(WASH_Z);
  });

  it("keeps the wash and the preview below every portalled overlay", () => {
    for (const file of PORTALLED) {
      expect(PREVIEW_Z, `${file} must outrank the preview`).toBeLessThan(
        overlayZ(file),
      );
    }
  });

  it("paints the preview wrapper at PREVIEW_Z", () => {
    const previewBlock = src.match(/!isPreviewTab[\s\S]*?<PreviewStack/)?.[0];
    expect(previewBlock).toMatch(/zIndex:\s*PREVIEW_Z/);
  });

  it("keeps the other tab-kind wrappers at the default stacking level", () => {
    // Only the preview wrapper opts out. Every other stack (terminal, editor,
    // markdown, git-diff, git-history) stays beneath the wash so the theme
    // background remains visible through them.
    expect((src.match(/zIndex:/g) ?? []).length).toBe(1);
  });
});
