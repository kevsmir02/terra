import { SPACE_COLORS } from "@/modules/spaces/lib/spaceColor";

// Tabs share the space palette so a tab and the space it belongs to can wear
// the same hue. Indexed by TerminalTab.color (opt-in).
export const TAB_COLORS = SPACE_COLORS;

export const TAB_COLOR_NAMES: readonly string[] = [
  "Blue",
  "Violet",
  "Emerald",
  "Amber",
  "Rose",
  "Cyan",
  "Orange",
  "Pink",
];

/** True for an index the palette can render; anything else is dropped. */
export function isTabColor(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < TAB_COLORS.length
  );
}

export function tabAccent(tab: { color?: number }): string | null {
  return isTabColor(tab.color) ? TAB_COLORS[tab.color] : null;
}
