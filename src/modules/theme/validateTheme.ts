import { isFontId } from "./fonts";
import {
  BORDER_STYLES,
  SYNTAX_ROLES,
  STATUS_ROLES,
  TEXT_TRANSFORMS,
  type Theme,
  type ThemeColors,
  type ThemeEmphasis,
  type ThemeShape,
  type ThemeTypography,
  type ThemeVariant,
  type TerminalPalette,
} from "./types";
import { TOKENS } from "./tokens";
import { parseColor } from "./oklab";
import type { Diagnostic } from "./diagnostics";

export type ValidationResult =
  | { ok: true; theme: Theme; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

const LENGTH_RE = /^(0|-?\d+(\.\d+)?(px|rem|em))$/;

export const COLOR_RE =
  /^(transparent|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([^;{}()]*\))$/;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const TERMINAL_FONT_WEIGHTS = new Set([
  "normal",
  "bold",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
]);
const TERMINAL_FONT_SIZE_MIN = 8;
const TERMINAL_FONT_SIZE_MAX = 32;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

const tokensByGroup: Record<string, (typeof TOKENS)[number][]> = {};
for (const t of TOKENS) {
  if (!tokensByGroup[t.group]) tokensByGroup[t.group] = [];
  tokensByGroup[t.group].push(t);
}

function validateTokenValue(
  v: unknown,
  def: (typeof TOKENS)[number],
  path: string,
  diagnostics: Diagnostic[]
): boolean {
  if (!isStr(v) || v.length === 0) {
    diagnostics.push({ severity: "error", path, message: `${path} must be a non-empty string` });
    return false;
  }
  if (def.kind === "color") {
    if (!COLOR_RE.test(v)) {
      diagnostics.push({ severity: "error", path, message: `${path} must be a colour such as #rrggbb, transparent, or oklch(...)` });
      return false;
    }
  } else if (def.kind === "textColor") {
    if (!COLOR_RE.test(v) || parseColor(v) === null) {
      diagnostics.push({ severity: "error", path, message: `${path} must be a parseable colour` });
      return false;
    }
  } else if (def.kind === "length") {
    if (!LENGTH_RE.test(v)) {
      diagnostics.push({ severity: "error", path, message: `${path} must be a CSS length such as 4px or 0` });
      return false;
    }
  } else if (def.kind === "keyword") {
    if (def.keywords && !def.keywords.includes(v)) {
      diagnostics.push({ severity: "error", path, message: `${path} must be one of: ${def.keywords.join(", ")}` });
      return false;
    }
    if (!def.keywords) {
      if (def.key === "colors.borderStyle" && !(BORDER_STYLES as readonly string[]).includes(v)) {
        diagnostics.push({ severity: "error", path, message: `${path} must be one of: ${BORDER_STYLES.join(", ")}` });
        return false;
      }
      if (def.key === "type.chromeTransform" && !(TEXT_TRANSFORMS as readonly string[]).includes(v)) {
        diagnostics.push({ severity: "error", path, message: `${path} must be one of: ${TEXT_TRANSFORMS.join(", ")}` });
        return false;
      }
    }
  } else if (def.kind === "alpha") {
    const num = Number(v);
    if (Number.isNaN(num) || num < 0 || num > 1) {
      diagnostics.push({ severity: "error", path, message: `${path} must be a number from 0 to 1` });
      return false;
    }
  }
  return true;
}

function parseTokens(raw: unknown, path: string, group: string, diagnostics: Diagnostic[]): Record<string, unknown> {
  if (raw === undefined) return {};
  if (!isObj(raw)) {
    diagnostics.push({ severity: "error", path, message: `${path} must be an object` });
    return {};
  }
  const out: Record<string, unknown> = {};
  const groupTokens = tokensByGroup[group] || [];
  
  for (const k of Object.keys(raw)) {
    const def = groupTokens.find(t => t.key === `${group}.${k}`);
    if (!def) {
      diagnostics.push({ severity: "warning", path: `${path}.${k}`, message: `${path}.${k} is not a recognized ${group} key` });
      continue;
    }
    const isValid = validateTokenValue(raw[k], def, `${path}.${k}`, diagnostics);
    if (isValid) {
      out[k] = raw[k];
    }
  }
  return out;
}

function parseTerminal(raw: unknown, path: string, diagnostics: Diagnostic[]): TerminalPalette {
  if (raw === undefined) return {};
  if (!isObj(raw)) {
    diagnostics.push({ severity: "error", path, message: `${path} must be an object` });
    return {};
  }
  
  const out: TerminalPalette = {};
  
  if (raw.background !== undefined) {
    if (!isStr(raw.background) || raw.background.length === 0) {
      diagnostics.push({ severity: "error", path: `${path}.background`, message: `${path}.background must be a non-empty string` });
    } else out.background = raw.background;
  }
  if (raw.foreground !== undefined) {
    if (!isStr(raw.foreground) || raw.foreground.length === 0) {
      diagnostics.push({ severity: "error", path: `${path}.foreground`, message: `${path}.foreground must be a non-empty string` });
    } else out.foreground = raw.foreground;
  }
  if (raw.cursor !== undefined) {
    if (!isStr(raw.cursor) || raw.cursor.length === 0) {
      diagnostics.push({ severity: "error", path: `${path}.cursor`, message: `${path}.cursor must be a non-empty string` });
    } else out.cursor = raw.cursor;
  }
  if (raw.cursorAccent !== undefined) {
    if (!isStr(raw.cursorAccent) || raw.cursorAccent.length === 0) {
      diagnostics.push({ severity: "error", path: `${path}.cursorAccent`, message: `${path}.cursorAccent must be a non-empty string` });
    } else out.cursorAccent = raw.cursorAccent;
  }
  if (raw.selection !== undefined) {
    if (!isStr(raw.selection) || raw.selection.length === 0) {
      diagnostics.push({ severity: "error", path: `${path}.selection`, message: `${path}.selection must be a non-empty string` });
    } else out.selection = raw.selection;
  }
  if (raw.fontFamily !== undefined) {
    if (!isStr(raw.fontFamily) || raw.fontFamily.trim().length === 0) {
      diagnostics.push({ severity: "error", path: `${path}.fontFamily`, message: `${path}.fontFamily must be a non-empty string` });
    } else {
      out.fontFamily = raw.fontFamily.trim();
    }
  }
  if (raw.fontWeight !== undefined) {
    if (!isStr(raw.fontWeight) || !TERMINAL_FONT_WEIGHTS.has(raw.fontWeight)) {
      diagnostics.push({ severity: "error", path: `${path}.fontWeight`, message: `${path}.fontWeight must be normal, bold, or a weight from 100 to 900` });
    } else {
      out.fontWeight = raw.fontWeight;
    }
  }
  if (raw.fontSize !== undefined) {
    if (
      typeof raw.fontSize !== "number" ||
      !Number.isInteger(raw.fontSize) ||
      raw.fontSize < TERMINAL_FONT_SIZE_MIN ||
      raw.fontSize > TERMINAL_FONT_SIZE_MAX
    ) {
      diagnostics.push({ severity: "error", path: `${path}.fontSize`, message: `${path}.fontSize must be an integer from ${TERMINAL_FONT_SIZE_MIN} to ${TERMINAL_FONT_SIZE_MAX}` });
    } else {
      out.fontSize = raw.fontSize;
    }
  }
  if (raw.ansi !== undefined) {
    if (!Array.isArray(raw.ansi) || raw.ansi.length !== 16) {
      diagnostics.push({ severity: "error", path: `${path}.ansi`, message: `${path}.ansi must be an array of 16 strings` });
    } else {
      let ok = true;
      for (let i = 0; i < 16; i++) {
        if (!isStr(raw.ansi[i])) {
          diagnostics.push({ severity: "error", path: `${path}.ansi[${i}]`, message: `${path}.ansi[${i}] must be a string` });
          ok = false;
        }
      }
      if (ok) out.ansi = raw.ansi as unknown as TerminalPalette["ansi"];
    }
  }
  return out;
}

function parseTypography(raw: unknown, path: string, diagnostics: Diagnostic[]): ThemeTypography {
  if (raw === undefined) return {};
  if (!isObj(raw)) {
    diagnostics.push({ severity: "error", path, message: `${path} must be an object` });
    return {};
  }
  const out: ThemeTypography = {};
  
  if (raw.fonts !== undefined) {
    if (!Array.isArray(raw.fonts) || !raw.fonts.every(isFontId)) {
      diagnostics.push({ severity: "error", path: `${path}.fonts`, message: `${path}.fonts must be an array of bundled font ids` });
    } else {
      out.fonts = raw.fonts;
    }
  }
  
  const rawTokens = { ...raw };
  delete rawTokens.fonts;
  
  const parsed = parseTokens(rawTokens, path, "type", diagnostics);
  return { ...out, ...parsed } as ThemeTypography;
}

function parseRoleMap<T extends string>(
  raw: unknown,
  path: string,
  roles: readonly T[],
  label: string,
  diagnostics: Diagnostic[]
): Partial<Record<T, string>> {
  if (raw === undefined) return {};
  if (!isObj(raw)) {
    diagnostics.push({ severity: "error", path, message: `${path} must be an object` });
    return {};
  }
  const out: Partial<Record<T, string>> = {};
  for (const k of Object.keys(raw)) {
    if (!(roles as readonly string[]).includes(k)) {
      diagnostics.push({ severity: "error", path: `${path}.${k}`, message: `${path}.${k} is not a recognized ${label} role` });
      continue;
    }
    const v = raw[k];
    if (!isStr(v) || v.length === 0) {
      diagnostics.push({ severity: "error", path: `${path}.${k}`, message: `${path}.${k} must be a non-empty string` });
      continue;
    }
    out[k as T] = v;
  }
  return out;
}

function parseVariant(raw: unknown, path: string, diagnostics: Diagnostic[]): ThemeVariant | undefined {
  if (!isObj(raw)) {
    diagnostics.push({ severity: "error", path, message: `${path} must be an object` });
    return undefined;
  }
  
  const colors = parseTokens(raw.colors, `${path}.colors`, "colors", diagnostics) as ThemeColors;
  const terminal = parseTerminal(raw.terminal, `${path}.terminal`, diagnostics);
  const shape = parseTokens(raw.shape, `${path}.shape`, "shape", diagnostics) as ThemeShape;
  const type = parseTypography(raw.type, `${path}.type`, diagnostics);
  const syntax = parseRoleMap(raw.syntax, `${path}.syntax`, SYNTAX_ROLES, "syntax", diagnostics);
  const status = parseRoleMap(raw.status, `${path}.status`, STATUS_ROLES, "status", diagnostics);
  const emphasis = parseTokens(
    raw.emphasis,
    `${path}.emphasis`,
    "emphasis",
    diagnostics,
  ) as ThemeEmphasis;

  return { colors, terminal, shape, type, syntax, status, emphasis };
}

export function validateTheme(raw: unknown): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  
  if (!isObj(raw)) {
    diagnostics.push({ severity: "error", path: "", message: "Theme must be a JSON object" });
    return { ok: false, diagnostics };
  }
  if (!isStr(raw.id) || !ID_RE.test(raw.id)) {
    diagnostics.push({ severity: "error", path: "id", message: "id must be a kebab-case string (a-z, 0-9, -)" });
  }
  let name = "";
  if (!isStr(raw.name) || raw.name.trim().length === 0) {
    diagnostics.push({ severity: "error", path: "name", message: "name must be a non-empty string" });
  } else {
    name = raw.name.trim();
  }
  
  const variants: Theme["variants"] = {};
  if (!isObj(raw.variants)) {
    diagnostics.push({ severity: "error", path: "variants", message: "variants must be an object" });
  } else {
    if (raw.variants.light !== undefined) {
      const v = parseVariant(raw.variants.light, "variants.light", diagnostics);
      if (v) variants.light = v;
    }
    if (raw.variants.dark !== undefined) {
      const v = parseVariant(raw.variants.dark, "variants.dark", diagnostics);
      if (v) variants.dark = v;
    }
    if (raw.variants.light === undefined && raw.variants.dark === undefined) {
      diagnostics.push({ severity: "error", path: "variants", message: "variants must contain at least one of: light, dark" });
    }
  }
  
  const hasErrors = diagnostics.some(d => d.severity === "error");
  
  if (hasErrors) {
    return { ok: false, diagnostics };
  }

  const theme: Theme = {
    id: raw.id as string,
    name,
    variants,
  };
  
  if (isStr(raw.author)) theme.author = raw.author;
  if (isStr(raw.description)) theme.description = raw.description;
  if (isObj(raw.editorTheme)) {
    const et: Theme["editorTheme"] = {};
    if (isStr(raw.editorTheme.light)) et.light = raw.editorTheme.light;
    if (isStr(raw.editorTheme.dark)) et.dark = raw.editorTheme.dark;
    if (et.light || et.dark) theme.editorTheme = et;
  }
  
  return { ok: true, theme, diagnostics };
}
