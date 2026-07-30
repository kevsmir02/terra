import { describe, expect, it } from "vitest";
import { statusFromAnsi, syntaxFromAnsi } from "../derive";
import { contrast, isHexColor } from "../oklab";
import { resolveVariant } from "../resolveVariant";
import {
  STATUS_ROLES,
  SYNTAX_ROLES,
  type StatusTokens,
  type SyntaxPalette,
  type ThemeMode,
} from "../types";
import { listBuiltinThemes } from "./index";

const DIM = new Set(["comment", "gutterFg", "tagBracket"]);

type Case = {
  id: string;
  mode: ThemeMode;
  bg: string;
  card: string | undefined;
  syntax: SyntaxPalette;
  status: StatusTokens;
  rawAnsi: readonly string[];
};

const cases: Case[] = [];
const seen = new Set<string>();
for (const theme of listBuiltinThemes()) {
  for (const mode of ["light", "dark"] as ThemeMode[]) {
    const resolved = resolveVariant(theme, mode);
    if (!resolved) continue;
    // Key on the mode that actually supplied the variant, not the requested one.
    // A dark-only theme resolves to its dark variant in both modes, so using the
    // requested mode would label one case "(light)" while testing dark data, and
    // would count the same palette twice.
    const key = `${theme.id}:${resolved.mode}`;
    if (seen.has(key)) continue;
    const { variant } = resolved;
    const bg = variant.colors?.background;
    if (!isHexColor(bg) || !variant.terminal?.ansi) continue;
    const syntax = syntaxFromAnsi(variant.terminal, variant.colors, variant.syntax);
    const status = statusFromAnsi(variant.terminal, variant.colors, variant.status);
    if (!syntax || !status) continue;
    seen.add(key);
    cases.push({
      id: theme.id,
      mode: resolved.mode,
      bg,
      card: variant.colors?.card,
      syntax,
      status,
      rawAnsi: variant.terminal.ansi,
    });
  }
}

// 20 distinct combinations today: nine two-variant themes with an ansi palette,
// plus one case each for the two dark-only themes. Adding a theme raises this,
// so a failure here means coverage was lost.
it("covers every built-in that declares an ansi palette", () => {
  expect(cases.length).toBeGreaterThanOrEqual(20);
});

describe.each(cases.map((c) => [c.id, c.mode, c] as const))(
  "%s (%s) derived palette",
  (_id, _mode, c) => {
    // Assert hex rather than skipping on it. Vitest reports a body that returns
    // without asserting as passed, so an early return here would let malformed
    // output from the OKLab maths silently delete the floor check, which is the
    // exact regression this file exists to catch. The card check stays
    // conditional because `card` is legitimately optional on a variant.
    it.each(SYNTAX_ROLES.map((r) => [r, c.syntax[r]] as const))(
      "%s clears its floor against the app background",
      (role, color) => {
        expect(isHexColor(color)).toBe(true);
        const floor = DIM.has(role) ? 3 : 4.5;
        expect(contrast(color, c.bg)).toBeGreaterThanOrEqual(floor - 0.02);
      },
    );

    it.each(STATUS_ROLES.map((r) => [r, c.status[r]] as const))(
      "status %s clears 4.5:1 on canvas and card",
      (_role, color) => {
        if (!isHexColor(color)) return;
        expect(contrast(color, c.bg)).toBeGreaterThanOrEqual(4.48);
        if (isHexColor(c.card)) {
          expect(contrast(color, c.card)).toBeGreaterThanOrEqual(4.48);
        }
      },
    );

    // The "not invisible" rule terminalLegibility enforces for ansi, applied
    // to the derived output.
    it.each(SYNTAX_ROLES.map((r) => [r, c.syntax[r]] as const))(
      "%s is not the background",
      (_role, color) => {
        expect(color.toLowerCase()).not.toBe(c.bg.toLowerCase());
      },
    );
  },
);

// These two are authored to a contrast budget rather than transcribed from an
// upstream palette. If normalization ever has to touch them, either a floor or
// the mapping has drifted.
describe.each(["stardew", "kanagawa-dragon"])("%s needs no adjustment", (id) => {
  const themeCases = cases.filter((c) => c.id === id);

  // Guards the block against silently covering nothing if a theme is renamed or
  // stops declaring an ansi palette.
  it("contributes at least one derived case", () => {
    expect(themeCases.length).toBeGreaterThan(0);
  });

  // Driven by the cases that exist rather than by both modes, because a
  // dark-only theme contributes one case, not two.
  it.each(themeCases.map((c) => [c.mode, c] as const))("in %s mode", (_mode, c) => {
    for (const role of SYNTAX_ROLES) {
      if (role === "variable" || role === "operator") continue;
      expect(c.rawAnsi).toContain(c.syntax[role]);
    }
  });
});
