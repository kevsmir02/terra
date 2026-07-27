import { isFontId } from "./fonts";
import {
  BORDER_STYLES,
  TEXT_TRANSFORMS,
  type BorderStyle,
  type TextTransform,
  type Theme,
  type ThemeColors,
  type ThemeShape,
  type ThemeTypography,
  type ThemeVariant,
  type TerminalPalette,
} from "./types";

export type ValidationResult =
  | { ok: true; theme: Theme }
  | { ok: false; error: string };

const COLOR_KEYS: readonly (keyof ThemeColors)[] = [
  "background", "foreground",
  "card", "cardForeground",
  "popover", "popoverForeground",
  "primary", "primaryForeground",
  "secondary", "secondaryForeground",
  "muted", "mutedForeground",
  "accent", "accentForeground",
  "destructive",
  "border", "input", "ring",
  "sidebar", "sidebarForeground",
  "sidebarPrimary", "sidebarPrimaryForeground",
  "sidebarAccent", "sidebarAccentForeground",
  "sidebarBorder", "sidebarRing",
  "radius",
  "borderStyle",
];

const SHAPE_LENGTH_KEYS: readonly (keyof ThemeShape)[] = [
  "frameWidth", "chromeWidth", "panelWidth", "slotWidth", "controlWidth",
  "bevelWidth", "liftDepth", "spacing",
];

const SHAPE_COLOR_KEYS: readonly (keyof ThemeShape)[] = [
  "bevelOuter", "bevelMid", "bevelInner", "liftColor",
];

// Lengths compose into a shared box-shadow, so they are matched rather than
// passed through: a comma or a function call would rewrite the declaration.
const LENGTH_RE = /^(0|-?\d+(\.\d+)?(px|rem|em))$/;

const TYPE_STRING_KEYS = ["sans", "mono", "display", "chromeTracking"] as const;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function parseColors(raw: unknown, path: string): ThemeColors | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return `${path} must be an object`;
  const out: ThemeColors = {};
  for (const k of Object.keys(raw)) {
    if (!(COLOR_KEYS as string[]).includes(k)) {
      return `${path}.${k} is not a recognized color key`;
    }
    const v = raw[k];
    if (!isStr(v) || v.length === 0) return `${path}.${k} must be a non-empty string`;
    // borderStyle lands in a CSS property that accepts a token sequence, so it
    // is allowlisted rather than passed through like the colour values.
    if (k === "borderStyle") {
      if (!(BORDER_STYLES as readonly string[]).includes(v)) {
        return `${path}.borderStyle must be one of: ${BORDER_STYLES.join(", ")}`;
      }
      out.borderStyle = v as BorderStyle;
      continue;
    }
    out[k as Exclude<keyof ThemeColors, "borderStyle">] = v;
  }
  return out;
}

function parseTerminal(raw: unknown, path: string): TerminalPalette | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return `${path} must be an object`;
  const out: TerminalPalette = {};
  if (raw.background !== undefined) {
    if (!isStr(raw.background)) return `${path}.background must be a string`;
    out.background = raw.background;
  }
  if (raw.foreground !== undefined) {
    if (!isStr(raw.foreground)) return `${path}.foreground must be a string`;
    out.foreground = raw.foreground;
  }
  if (raw.cursor !== undefined) {
    if (!isStr(raw.cursor)) return `${path}.cursor must be a string`;
    out.cursor = raw.cursor;
  }
  if (raw.cursorAccent !== undefined) {
    if (!isStr(raw.cursorAccent)) return `${path}.cursorAccent must be a string`;
    out.cursorAccent = raw.cursorAccent;
  }
  if (raw.selection !== undefined) {
    if (!isStr(raw.selection)) return `${path}.selection must be a string`;
    out.selection = raw.selection;
  }
  if (raw.ansi !== undefined) {
    if (!Array.isArray(raw.ansi) || raw.ansi.length !== 16) {
      return `${path}.ansi must be an array of 16 strings`;
    }
    for (let i = 0; i < 16; i++) {
      if (!isStr(raw.ansi[i])) return `${path}.ansi[${i}] must be a string`;
    }
    out.ansi = raw.ansi as unknown as TerminalPalette["ansi"];
  }
  return out;
}

function parseShape(raw: unknown, path: string): ThemeShape | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return `${path} must be an object`;
  const out: ThemeShape = {};
  for (const k of Object.keys(raw)) {
    const isLength = (SHAPE_LENGTH_KEYS as string[]).includes(k);
    const isColor = (SHAPE_COLOR_KEYS as string[]).includes(k);
    if (!isLength && !isColor) {
      return `${path}.${k} is not a recognized shape key`;
    }
    const v = raw[k];
    if (!isStr(v) || v.length === 0) {
      return `${path}.${k} must be a non-empty string`;
    }
    if (isLength && !LENGTH_RE.test(v)) {
      return `${path}.${k} must be a CSS length such as 4px or 0`;
    }
    out[k as keyof ThemeShape] = v;
  }
  return out;
}

function parseTypography(raw: unknown, path: string): ThemeTypography | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return `${path} must be an object`;
  const out: ThemeTypography = {};
  for (const k of Object.keys(raw)) {
    if (k === "fonts") {
      if (!Array.isArray(raw.fonts) || !raw.fonts.every(isFontId)) {
        return `${path}.fonts must be an array of bundled font ids`;
      }
      out.fonts = raw.fonts;
      continue;
    }
    const v = raw[k];
    if (!isStr(v) || v.length === 0) {
      return `${path}.${k} must be a non-empty string`;
    }
    if (k === "chromeTransform") {
      if (!(TEXT_TRANSFORMS as readonly string[]).includes(v)) {
        return `${path}.chromeTransform must be one of: ${TEXT_TRANSFORMS.join(", ")}`;
      }
      out.chromeTransform = v as TextTransform;
      continue;
    }
    if (!(TYPE_STRING_KEYS as readonly string[]).includes(k)) {
      return `${path}.${k} is not a recognized typography key`;
    }
    out[k as (typeof TYPE_STRING_KEYS)[number]] = v;
  }
  return out;
}

function parseVariant(raw: unknown, path: string): ThemeVariant | string {
  if (!isObj(raw)) return `${path} must be an object`;
  const colors = parseColors(raw.colors, `${path}.colors`);
  if (typeof colors === "string") return colors;
  const terminal = parseTerminal(raw.terminal, `${path}.terminal`);
  if (typeof terminal === "string") return terminal;
  const shape = parseShape(raw.shape, `${path}.shape`);
  if (typeof shape === "string") return shape;
  const type = parseTypography(raw.type, `${path}.type`);
  if (typeof type === "string") return type;
  return { colors, terminal, shape, type };
}


export function validateTheme(raw: unknown): ValidationResult {
  if (!isObj(raw)) return { ok: false, error: "Theme must be a JSON object" };
  if (!isStr(raw.id) || !ID_RE.test(raw.id)) {
    return { ok: false, error: "id must be a kebab-case string (a-z, 0-9, -)" };
  }
  if (!isStr(raw.name) || raw.name.trim().length === 0) {
    return { ok: false, error: "name must be a non-empty string" };
  }
  if (!isObj(raw.variants)) return { ok: false, error: "variants must be an object" };
  const variants: Theme["variants"] = {};
  if (raw.variants.light !== undefined) {
    const v = parseVariant(raw.variants.light, "variants.light");
    if (typeof v === "string") return { ok: false, error: v };
    variants.light = v;
  }
  if (raw.variants.dark !== undefined) {
    const v = parseVariant(raw.variants.dark, "variants.dark");
    if (typeof v === "string") return { ok: false, error: v };
    variants.dark = v;
  }
  if (!variants.light && !variants.dark) {
    return { ok: false, error: "variants must contain at least one of: light, dark" };
  }
  const theme: Theme = {
    id: raw.id,
    name: raw.name.trim(),
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
  return { ok: true, theme };
}
