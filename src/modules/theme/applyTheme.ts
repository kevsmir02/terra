import { statusFromAnsi, syntaxFromAnsi } from "./derive";
import { resolveVariant } from "./resolveVariant";
import type {
  StatusRole,
  SyntaxRole,
  Theme,
  ThemeColors,
  ThemeMode,
  TerminalPalette,
  ThemeShape,
  ThemeTypography,
} from "./types";

const COLOR_VAR: Record<keyof ThemeColors, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarRing: "--sidebar-ring",
  radius: "--radius",
  borderStyle: "--border-style",
};

const SHAPE_VAR: Record<keyof ThemeShape, string> = {
  frameWidth: "--frame-border-width",
  frameRadius: "--frame-radius",
  framePadding: "--frame-padding",
  chromeWidth: "--chrome-border-width",
  panelWidth: "--panel-border-width",
  slotWidth: "--slot-border-width",
  controlWidth: "--control-border-width",
  bevelWidth: "--bevel-width",
  bevelOuter: "--bevel-outer",
  bevelMid: "--bevel-mid",
  bevelInner: "--bevel-inner",
  liftColor: "--lift-color",
  liftDepth: "--lift-depth",
  spacing: "--ui-spacing",
};

const TYPE_VAR: Record<Exclude<keyof ThemeTypography, "fonts">, string> = {
  sans: "--ui-font-sans",
  mono: "--ui-font-mono",
  display: "--ui-font-display",
  chromeTracking: "--chrome-tracking",
  chromeTransform: "--chrome-transform",
};

const ANSI_VARS: readonly string[] = [
  "--terminal-ansi-black",
  "--terminal-ansi-red",
  "--terminal-ansi-green",
  "--terminal-ansi-yellow",
  "--terminal-ansi-blue",
  "--terminal-ansi-magenta",
  "--terminal-ansi-cyan",
  "--terminal-ansi-white",
  "--terminal-ansi-bright-black",
  "--terminal-ansi-bright-red",
  "--terminal-ansi-bright-green",
  "--terminal-ansi-bright-yellow",
  "--terminal-ansi-bright-blue",
  "--terminal-ansi-bright-magenta",
  "--terminal-ansi-bright-cyan",
  "--terminal-ansi-bright-white",
];

const SYNTAX_VAR: Record<SyntaxRole, string> = {
  comment: "--syntax-comment",
  keyword: "--syntax-keyword",
  string: "--syntax-string",
  number: "--syntax-number",
  constant: "--syntax-constant",
  func: "--syntax-func",
  variable: "--syntax-variable",
  property: "--syntax-property",
  gutterFg: "--syntax-gutter-fg",
  type: "--syntax-type",
  operator: "--syntax-operator",
  tag: "--syntax-tag",
  tagBracket: "--syntax-tag-bracket",
  attr: "--syntax-attr",
  attrValue: "--syntax-attr-value",
  heading: "--syntax-heading",
  link: "--syntax-link",
  invalid: "--syntax-invalid",
};

const STATUS_VAR: Record<StatusRole, string> = {
  added: "--status-added",
  modified: "--status-modified",
  deleted: "--status-deleted",
  renamed: "--status-renamed",
  warning: "--status-warning",
  conflict: "--status-conflict",
  ok: "--status-ok",
};

export const ALL_VARS: readonly string[] = [
  ...Object.values(COLOR_VAR),
  ...Object.values(SHAPE_VAR),
  ...Object.values(TYPE_VAR),
  ...Object.values(SYNTAX_VAR),
  ...Object.values(STATUS_VAR),
  "--terminal-background",
  "--terminal-foreground",
  "--terminal-cursor",
  "--terminal-cursor-accent",
  "--terminal-selection",
  ...ANSI_VARS,
];

let lastApplied: string | null = null;

export type ThemeVar = readonly [name: string, value: string];

export function resolveThemeVars(theme: Theme, mode: ThemeMode): ThemeVar[] | null {
  const resolved = resolveVariant(theme, mode);
  if (!resolved) return null;
  const { variant } = resolved;
  const out: ThemeVar[] = [];
  if (variant.colors) collectColors(out, variant.colors);
  if (variant.terminal) collectTerminal(out, variant.terminal);
  if (variant.shape) collectShape(out, variant.shape);
  if (variant.type) collectType(out, variant.type);
  const syntax = syntaxFromAnsi(variant.terminal, variant.colors, variant.syntax);
  if (syntax) {
    for (const role of Object.keys(syntax) as SyntaxRole[]) {
      out.push([SYNTAX_VAR[role], syntax[role]]);
    }
  }
  const status = statusFromAnsi(variant.terminal, variant.colors, variant.status);
  if (status) {
    for (const role of Object.keys(status) as StatusRole[]) {
      out.push([STATUS_VAR[role], status[role]]);
    }
  }
  return out;
}

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const vars = resolveThemeVars(theme, mode);
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

function collectColors(out: ThemeVar[], c: ThemeColors): void {
  for (const k of Object.keys(c) as (keyof ThemeColors)[]) {
    const v = c[k];
    if (v) out.push([COLOR_VAR[k], v]);
  }
}

function collectShape(out: ThemeVar[], s: ThemeShape): void {
  for (const k of Object.keys(s) as (keyof ThemeShape)[]) {
    const v = s[k];
    if (v) out.push([SHAPE_VAR[k], v]);
  }
}

function collectType(out: ThemeVar[], t: ThemeTypography): void {
  for (const k of Object.keys(t) as (keyof ThemeTypography)[]) {
    if (k === "fonts") continue;
    const v = t[k];
    if (v) out.push([TYPE_VAR[k], v]);
  }
}

function collectTerminal(out: ThemeVar[], t: TerminalPalette): void {
  if (t.background) out.push(["--terminal-background", t.background]);
  if (t.foreground) out.push(["--terminal-foreground", t.foreground]);
  if (t.cursor) out.push(["--terminal-cursor", t.cursor]);
  if (t.cursorAccent) out.push(["--terminal-cursor-accent", t.cursorAccent]);
  if (t.selection) out.push(["--terminal-selection", t.selection]);
  if (t.ansi) {
    for (let i = 0; i < ANSI_VARS.length && i < t.ansi.length; i++) {
      out.push([ANSI_VARS[i], t.ansi[i]]);
    }
  }
}
