import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { ALL_VARS, blurMode } from "./applyTheme";
import { resolveTheme } from "./resolveTheme";
import { BUILTIN } from "./themes";
import { TOKENS } from "./tokens";
import type { Theme } from "./types";

it("clears exactly the variables the registry declares", () => {
  expect([...ALL_VARS].sort()).toEqual(TOKENS.map((t) => t.cssVar).sort());
});

it("reports blur off for a theme that declines it, on otherwise", () => {
  const base = { colors: { background: "#000000" } };
  const off: Theme = {
    id: "blur-off",
    name: "Blur off",
    variants: { dark: { ...base, effects: { blur: "off" } } },
  };
  const on: Theme = {
    id: "blur-on",
    name: "Blur on",
    variants: { dark: base },
  };
  expect(blurMode(resolveTheme(off, "dark") ?? [])).toBe("off");
  expect(blurMode(resolveTheme(on, "dark") ?? [])).toBe("on");
});

it("scales motion per theme and leaves reduced-motion its own multiplier", () => {
  const speed = TOKENS.find((t) => t.key === "motion.speed");
  const ease = TOKENS.find((t) => t.key === "motion.easing");
  expect(speed?.cssVar).toBe("--motion-scale");
  expect(ease?.cssVar).toBe("--motion-ease");
  // applyTheme writes these as inline styles on the root, which outrank any
  // stylesheet rule. The reduced-motion media query must therefore collapse a
  // variable applyTheme never writes, or a theme's own scale would win.
  const css = readFileSync(
    path.resolve(__dirname, "../../styles/globals.css"),
    "utf8",
  );
  const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
  expect(reduced).toContain("--motion-reduce");
  expect(reduced).not.toContain("--motion-scale:");
  expect(ALL_VARS).not.toContain("--motion-reduce");
});

it("gives every builtin theme a motion personality", () => {
  for (const theme of BUILTIN) {
    for (const [mode, variant] of Object.entries(theme.variants)) {
      expect(variant?.motion, `${theme.id} ${mode}`).toBeDefined();
    }
  }
});
