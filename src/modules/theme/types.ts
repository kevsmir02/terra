import type { FontId } from "./fonts";

export type ThemeMode = "light" | "dark";

export const BORDER_STYLES = [
  "solid",
  "dashed",
  "dotted",
  "double",
  "none",
] as const;

export type BorderStyle = (typeof BORDER_STYLES)[number];

export type ThemeColors = Partial<{
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  radius: string;
  borderStyle: BorderStyle;
}>;

export type TerminalPalette = Partial<{
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  ansi: readonly [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
}>;

export const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase"] as const;

export type TextTransform = (typeof TEXT_TRANSFORMS)[number];

export type ThemeShape = Partial<{
  frameWidth: string;
  frameRadius: string;
  framePadding: string;
  chromeWidth: string;
  panelWidth: string;
  slotWidth: string;
  controlWidth: string;
  bevelWidth: string;
  bevelOuter: string;
  bevelMid: string;
  bevelInner: string;
  liftColor: string;
  liftDepth: string;
  spacing: string;
}>;

export type ThemeTypography = Partial<{
  sans: string;
  mono: string;
  display: string;
  chromeTracking: string;
  chromeTransform: TextTransform;
  fonts?: readonly FontId[];
}>;

export const SYNTAX_ROLES = [
  "comment", "keyword", "string", "number", "constant", "func",
  "variable", "property", "gutterFg", "type", "operator", "tag",
  "tagBracket", "attr", "attrValue", "heading", "link", "invalid",
] as const;

export type SyntaxRole = (typeof SYNTAX_ROLES)[number];

export const STATUS_ROLES = [
  "added", "modified", "deleted", "renamed", "warning", "conflict", "ok",
] as const;

export type StatusRole = (typeof STATUS_ROLES)[number];

export type SyntaxPalette = Record<SyntaxRole, string>;
export type StatusTokens = Record<StatusRole, string>;

export type ThemeVariant = {
  colors?: ThemeColors;
  terminal?: TerminalPalette;
  shape?: ThemeShape;
  type?: ThemeTypography;
  syntax?: Partial<Record<SyntaxRole, string>>;
  status?: Partial<Record<StatusRole, string>>;
};


export type Theme = {
  id: string;
  name: string;
  author?: string;
  description?: string;
  variants: {
    light?: ThemeVariant;
    dark?: ThemeVariant;
  };
  editorTheme?: {
    light?: string;
    dark?: string;
  };
};

export const DEFAULT_THEME_ID = "terra-default";
