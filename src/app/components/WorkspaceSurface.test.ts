import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level regression test: the theme's background-image wash
 * (SurfaceLayer) paints at OVERLAY_Z above the whole app so it's visible
 * through translucent chrome everywhere. The preview pane renders a live,
 * external iframe and must stay pixel-accurate, so its wrapper opts out by
 * painting above OVERLAY_Z instead of at the default stacking level. If a
 * future edit drops or lowers that override, the wash silently bleeds back
 * onto preview content.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "WorkspaceSurface.tsx"), "utf8");

describe("WorkspaceSurface preview stacking", () => {
  it("imports OVERLAY_Z from the theme module", () => {
    expect(src).toMatch(/import\s*{\s*OVERLAY_Z\s*}\s*from\s*"@\/modules\/theme"/);
  });

  it("paints the preview wrapper strictly above OVERLAY_Z", () => {
    const previewBlock = src.match(
      /!isPreviewTab[\s\S]*?<PreviewStack/,
    )?.[0];
    expect(previewBlock).toBeTruthy();
    const zIndexMatch = previewBlock?.match(
      /zIndex:\s*OVERLAY_Z\s*\+\s*(\d+)/,
    );
    expect(zIndexMatch).toBeTruthy();
    expect(Number(zIndexMatch?.[1])).toBeGreaterThan(0);
  });

  it("keeps the other tab-kind wrappers below OVERLAY_Z", () => {
    // Only the preview wrapper should set an explicit z-index - every other
    // stack (terminal, editor, markdown, git-diff, git-history) should stay
    // at the default stacking level, beneath the wash, so the theme
    // background remains visible through them.
    const zIndexSites = src.match(/zIndex:/g) ?? [];
    expect(zIndexSites.length).toBe(1);
  });
});
