import { resolveVariant } from "./resolveVariant";
import { TOKENS } from "./tokens";
import type { ThemeVar } from "./applyTheme";
import type { DerivedValues } from "./tokens";
import type { Theme, ThemeMode, ThemeVariant } from "./types";

const ANSI_KEYS = [
  "terminal.ansiBlack", "terminal.ansiRed", "terminal.ansiGreen", "terminal.ansiYellow",
  "terminal.ansiBlue", "terminal.ansiMagenta", "terminal.ansiCyan", "terminal.ansiWhite",
  "terminal.ansiBrightBlack", "terminal.ansiBrightRed", "terminal.ansiBrightGreen",
  "terminal.ansiBrightYellow", "terminal.ansiBrightBlue", "terminal.ansiBrightMagenta",
  "terminal.ansiBrightCyan", "terminal.ansiBrightWhite",
];

function readAuthored(variant: ThemeVariant, key: string): string | undefined {
  const ansiIdx = ANSI_KEYS.indexOf(key);
  if (ansiIdx !== -1) {
    return variant.terminal?.ansi?.[ansiIdx];
  }
  const parts = key.split(".");
  let current: unknown = variant;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function resolveTheme(theme: Theme, mode: ThemeMode): ThemeVar[] | null {
  const resolved = resolveVariant(theme, mode);
  if (!resolved) return null;
  const { variant } = resolved;

  const byKey = new Map(TOKENS.map((t) => [t.key, t]));
  const values: Record<string, string | undefined> = {};
  const ansi = variant.terminal?.ansi;
  const done = new Set<string>();

  const resolveOne = (key: string): void => {
    if (done.has(key)) return;
    done.add(key);
    const def = byKey.get(key);
    if (!def) return;
    for (const d of def.deps ?? []) resolveOne(d);
    const raw = readAuthored(variant, key);
    const authored = raw !== undefined && def.map ? (def.map[raw] ?? raw) : raw;
    const derivedValues: DerivedValues = Object.assign({}, values, { ansi });
    values[key] = authored ?? def.derive?.(derivedValues) ?? def.fallback;
  };

  for (const t of TOKENS) resolveOne(t.key);

  const out: ThemeVar[] = [];
  for (const t of TOKENS) {
    const v = values[t.key];
    if (v !== undefined) out.push([t.cssVar, v]);
  }
  return out;
}
