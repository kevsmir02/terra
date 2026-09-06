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
  bevelWidth: string;
  bevelOuter: string;
  bevelMid: string;
  bevelInner: string;
  spacing: string;
  pillRadius: string;
}>;

export type ThemeTypography = Partial<{
  chromeTracking: string;
  chromeTransform: TextTransform;
}>;

export const BLUR_MODES = ["on", "off"] as const;

export type BlurMode = (typeof BLUR_MODES)[number];

/**
 * Ambient effects. `shadow` is the tint every shadow utility uses, so
 * `transparent` flattens the app; `wallpaper: false` declines the user's
 * background image while the theme is active.
 */
export type ThemeEffects = Partial<{
  shadow: string;
  blur: BlurMode;
  wallpaper: boolean;
}>;

export const ICON_SETS = ["catppuccin", "nerd"] as const;

export type IconSet = (typeof ICON_SETS)[number];

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

export const EMPHASIS_STEPS = [
  "faint",
  "subtle",
  "soft",
  "medium",
  "strong",
  "bold",
] as const;

export type EmphasisStep = (typeof EMPHASIS_STEPS)[number];

/**
 * Alpha ladder the UI reads for every token-on-token blend. A theme whose
 * design leans on outlines rather than value shifts raises these; one that
 * wants surfaces to melt together lowers them.
 */
export type ThemeEmphasis = Partial<Record<EmphasisStep, string>>;

export type ThemeVariant = {
  colors?: ThemeColors;
  terminal?: TerminalPalette;
  shape?: ThemeShape;
  type?: ThemeTypography;
  effects?: ThemeEffects;
  icons?: IconSet;
  syntax?: Partial<Record<SyntaxRole, string>>;
  status?: Partial<Record<StatusRole, string>>;
  emphasis?: ThemeEmphasis;
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
};

export const DEFAULT_THEME_ID = "terra-default";
