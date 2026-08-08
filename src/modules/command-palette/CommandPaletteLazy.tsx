import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { CommandPalette as CommandPaletteType } from "./CommandPalette";

const CommandPaletteInner = lazy(() =>
  import("./CommandPalette").then((m) => ({ default: m.CommandPalette })),
);

type Props = ComponentProps<typeof CommandPaletteType>;

/**
 * The palette is a modal: nothing renders until the user opens it, so its
 * fuzzy matcher, MRU store and icon resolver stay out of the startup graph.
 * Callers must gate the mount on first open (App latches `paletteMounted`) -
 * rendering this with `open={false}` would fetch the chunk at startup anyway,
 * which is the cost the split exists to avoid. Once mounted it stays mounted,
 * so the dialog keeps its exit animation and later opens are instant.
 */
export function CommandPalette(props: Props) {
  return (
    <Suspense fallback={null}>
      <CommandPaletteInner {...props} />
    </Suspense>
  );
}
