import { describe, expect, it } from "vitest";
import { contrast, parseColor } from "../oklab";
import { resolveTheme } from "../resolveTheme";
import { TOKENS } from "../tokens";
import type { ThemeMode } from "../types";
import { listBuiltinThemes } from "./index";

/**
 * Asserts the contrast floors on resolved output rather than on the derivation
 * helpers, so an override or a registry fallback is covered the same way a
 * derived value is. The snapshot in resolveTheme.test.ts records what the
 * builtins produce; this file is what makes those values legible rather than
 * merely stable, and it would fail on a snapshot that was updated to a value
 * below the floor.
 */

// Comment-weight roles are meant to recede, so they hold the 3:1 tier THEME.md
// documents for slot 8 instead of the 4.5:1 body-text floor.
const DIM = new Set(["syntax.comment", "syntax.gutterFg", "syntax.tagBracket"]);

const MODES: ThemeMode[] = ["light", "dark"];

const SYNTAX = TOKENS.filter((t) => t.group === "syntax");
const STATUS = TOKENS.filter((t) => t.group === "status");

type Case = {
  label: string;
  bg: string;
  card: string | undefined;
  value: (cssVar: string) => string | undefined;
};

// terra-default authors no variant colors: it is the globals.css baseline, and
// ThemeProvider clears the variables for it rather than applying any, so there
// is no resolved --background to measure against. Every builtin that does
// author colors has to be covered, in both modes.
const MEASURABLE = listBuiltinThemes().filter(
  (t) => t.variants.light?.colors || t.variants.dark?.colors,
);

const cases: Case[] = [];
for (const theme of listBuiltinThemes()) {
  for (const mode of MODES) {
    const vars = resolveTheme(theme, mode);
    if (!vars) continue;
    const map = new Map(vars);
    const bg = map.get("--background");
    if (!bg) continue;
    cases.push({
      label: `${theme.id}/${mode}`,
      bg,
      card: map.get("--card"),
      value: (cssVar) => map.get(cssVar),
    });
  }
}

// A measurable pair is one both sides of which the contrast maths can read.
// Translucent or unparseable values have no fixed ratio, so they are reported
// as skipped rather than silently passing.
function ratio(color: string | undefined, bg: string): number | null {
  if (!color || !parseColor(color) || !parseColor(bg)) return null;
  return contrast(color, bg);
}

describe("builtin syntax legibility", () => {
  it("covers every builtin in both modes", () => {
    expect(cases.length).toBe(MEASURABLE.length * MODES.length);
  });

  it.each(SYNTAX.map((t) => [t.key, t.cssVar] as const))(
    "%s clears its floor on the canvas",
    (key, cssVar) => {
      const floor = DIM.has(key) ? 3 : 4.5;
      let measured = 0;
      for (const c of cases) {
        const r = ratio(c.value(cssVar), c.bg);
        if (r === null) continue;
        measured++;
        expect(r, `${c.label} ${key}`).toBeGreaterThanOrEqual(floor - 0.02);
      }
      expect(measured, `${key} was never measurable`).toBeGreaterThan(0);
    },
  );

  it.each(STATUS.map((t) => [t.key, t.cssVar] as const))(
    "%s clears 4.5:1 on canvas and card",
    (key, cssVar) => {
      let measured = 0;
      for (const c of cases) {
        const onBg = ratio(c.value(cssVar), c.bg);
        if (onBg === null) continue;
        measured++;
        expect(onBg, `${c.label} ${key} on canvas`).toBeGreaterThanOrEqual(
          4.48,
        );
        const onCard = ratio(c.value(cssVar), c.card ?? "");
        if (onCard !== null) {
          expect(onCard, `${c.label} ${key} on card`).toBeGreaterThanOrEqual(
            4.48,
          );
        }
      }
      expect(measured, `${key} was never measurable`).toBeGreaterThan(0);
    },
  );

  it.each(SYNTAX.map((t) => [t.key, t.cssVar] as const))(
    "%s is not the background colour",
    (key, cssVar) => {
      for (const c of cases) {
        const v = c.value(cssVar);
        if (!v) continue;
        expect(v.toLowerCase(), `${c.label} ${key}`).not.toBe(
          c.bg.toLowerCase(),
        );
      }
    },
  );
});
