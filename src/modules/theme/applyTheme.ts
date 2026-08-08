import { resolveTheme } from "./resolveTheme";
import { TOKENS } from "./tokens";
import type { Theme, ThemeMode } from "./types";

export const ALL_VARS: readonly string[] = TOKENS.map((t) => t.cssVar);

let lastApplied: string | null = null;

export type ThemeVar = readonly [name: string, value: string];

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const vars = resolveTheme(theme, mode);
  if (!vars) {
    clearTheme();
    return;
  }
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  for (const [name, value] of vars) root.style.setProperty(name, value);
  lastApplied = theme.id;
}

export function clearTheme(): void {
  if (lastApplied === null) return;
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  lastApplied = null;
}
