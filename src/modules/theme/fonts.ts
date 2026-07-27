export const FONT_IDS = ["pixelify-sans", "press-start-2p", "vt323"] as const;

export type FontId = (typeof FONT_IDS)[number];

export function isFontId(v: unknown): v is FontId {
  return typeof v === "string" && (FONT_IDS as readonly string[]).includes(v);
}

const loaded = new Set<FontId>();

// Font CSS is imported only when a theme names it, so an unused face costs
// nothing in the eager bundle.
const LOADERS: Record<FontId, () => Promise<unknown>> = {
  // Local stylesheet rather than the @fontsource index: it adds size-adjust,
  // which the package's own @font-face cannot carry. See the file header.
  "pixelify-sans": () => import("@/styles/pixelify-sans.css"),
  "press-start-2p": () => import("@fontsource/press-start-2p"),
  vt323: () => import("@fontsource/vt323"),
};

export async function loadFonts(ids: readonly FontId[]): Promise<void> {
  await Promise.all(
    ids
      .filter((id) => !loaded.has(id))
      .map(async (id) => {
        await LOADERS[id]();
        loaded.add(id);
      }),
  );
}
