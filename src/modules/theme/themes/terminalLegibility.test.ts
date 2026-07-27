import { describe, expect, it } from "vitest";
import type { Theme, ThemeMode, ThemeVariant } from "../types";
import { listBuiltinThemes } from "./index";

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const n = Number.parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Palette = { bg: string; fg: string; ansi: readonly string[] };

function palette(v: ThemeVariant | undefined): Palette | null {
  const t = v?.terminal;
  if (!t?.ansi || !t.background || !t.foreground) return null;
  return { bg: t.background, fg: t.foreground, ansi: t.ansi };
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
  // as a color choice. Retro Pixel shipped brightWhite === background.
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
});

// Retro Pixel is authored to a contrast budget rather than transcribed from an
// upstream palette, so it is the one theme that can hold the numeric floor.
describe("retro-pixel terminal contrast budget", () => {
  const theme = listBuiltinThemes().find(
    (t: Theme) => t.id === "retro-pixel",
  ) as Theme;

  describe.each(["light", "dark"] as ThemeMode[])("%s", (mode) => {
    const p = palette(theme.variants[mode]) as Palette;

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

    // Dim/comment text. The shipped dark variant sat at 1.6:1 here.
    it("keeps bright black usable for dim text", () => {
      expect(contrast(p.ansi[8], p.bg)).toBeGreaterThanOrEqual(3);
    });
  });
});
