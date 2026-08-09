import { describe, expect, it } from "vitest";
import type { ThemeMode, ThemeVariant } from "../types";
import { listBuiltinThemes } from "./index";
import { contrast } from "../oklab";

type Palette = { bg: string; fg: string; ansi: readonly string[] };

// A theme that omits terminal.background/foreground is not untested, it renders
// on the app canvas: globals.css maps --terminal-background to var(--background)
// and --terminal-foreground to var(--foreground). Reading the same fallback the
// engine reads is what puts every palette under the floors below. Requiring the
// keys to be declared instead is what let three builtins ship unmeasured.
function palette(v: ThemeVariant | undefined): Palette | null {
  const ansi = v?.terminal?.ansi;
  if (!ansi) return null;
  const bg = v.terminal?.background ?? v.colors?.background;
  const fg = v.terminal?.foreground ?? v.colors?.foreground;
  if (!bg || !fg) return null;
  return { bg, fg, ansi };
}

const NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
] as const;

const cases: [string, ThemeMode, Palette][] = [];
for (const theme of listBuiltinThemes()) {
  for (const mode of ["light", "dark"] as ThemeMode[]) {
    const p = palette(theme.variants[mode]);
    if (p) cases.push([theme.id, mode, p]);
  }
}

describe.each(cases)("%s (%s) terminal palette", (_id, _mode, p) => {
  it("keeps default text readable", () => {
    expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(4.5);
  });

  // A slot that matches the background renders as invisible text rather than
  // as a color choice. Retro Pixel shipped brightWhite === background, and the
  // canonical Gruvbox light mapping puts the background in slot 0.
  it.each(p.ansi.map((c, i) => [NAMES[i % 8], i, c] as const))(
    "%s (slot %i) is not the background",
    (_name, _i, color) => {
      expect(color.toLowerCase()).not.toBe(p.bg.toLowerCase());
    },
  );

  it.each([
    ["blue", 4, "cyan", 6],
    ["bright blue", 12, "bright cyan", 14],
  ] as const)("separates %s from %s", (_a, ai, _b, bi) => {
    expect(p.ansi[ai].toLowerCase()).not.toBe(p.ansi[bi].toLowerCase());
  });

  // Slot 0 is exempt from the ratio: it is legitimately near-background on dark
  // themes. It is not exempt from the equality check above.
  it.each(p.ansi.slice(1, 8).map((c, i) => [NAMES[i + 1], c] as const))(
    "%s clears 4.5:1",
    (_name, color) => {
      expect(contrast(color, p.bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(p.ansi.slice(9, 16).map((c, i) => [NAMES[i + 1], c] as const))(
    "bright %s clears 3:1",
    (_name, color) => {
      expect(contrast(color, p.bg)).toBeGreaterThanOrEqual(3);
    },
  );

  // Dim/comment text. This is the slot everyone gets wrong: a "subtle" value
  // lands near 1.6:1 and makes every comment in the terminal unreadable.
  it("keeps bright black usable for dim text", () => {
    expect(contrast(p.ansi[8], p.bg)).toBeGreaterThanOrEqual(3);
  });
});
