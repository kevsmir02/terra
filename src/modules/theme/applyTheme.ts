import { resolveTheme } from "./resolveTheme";
import { TOKENS } from "./tokens";
import type { Theme, ThemeMode } from "./types";

export const ALL_VARS: readonly string[] = TOKENS.map((t) => t.cssVar);

const BLUR_VAR = "--fx-blur-factor";

/**
 * Whether the resolved theme wants a backdrop pass at all.
 *
 * A zeroed blur scale still leaves `backdrop-filter: blur(0px)` in place, and
 * that promotes a layer and re-reads the backdrop every frame regardless of
 * radius. Stamping the answer on the root lets one stylesheet rule drop the
 * pass outright rather than shrink it.
 */
export function blurMode(vars: readonly ThemeVar[]): "on" | "off" {
  return vars.some(([name, value]) => name === BLUR_VAR && value === "0")
    ? "off"
    : "on";
}

export type ThemeVar = readonly [name: string, value: string];

let lastApplied: string | null = null;

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const vars = resolveTheme(theme, mode);
  if (!vars) {
    clearTheme();
    return;
  }
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  for (const [name, value] of vars) root.style.setProperty(name, value);
  root.dataset.fxBlur = blurMode(vars);
  lastApplied = theme.id;
}

function clearTheme(): void {
  if (lastApplied === null) return;
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  delete root.dataset.fxBlur;
  lastApplied = null;
}
