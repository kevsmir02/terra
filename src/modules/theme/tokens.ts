import { ensureContrast } from "./oklab";


export type TokenKind =
  | "color"
  | "textColor"
  | "length"
  | "keyword"
  | "alpha";

export type DerivedValues = Readonly<Record<string, string | undefined>> & {
  readonly ansi?: readonly string[];
};

export type TokenDef = {
  /** Dotted path into the variant, e.g. "colors.background". */
  key: string;
  cssVar: string;
  group: "colors" | "terminal" | "shape" | "type" | "syntax" | "status" | "emphasis";
  kind: TokenKind;
  /** Keys `derive` reads. Drives the topological order. */
  deps?: readonly string[];
  derive?: (d: DerivedValues) => string | undefined;
  fallback?: string;
  keywords?: readonly string[];
  doc: string;
};

export const TOKENS: readonly TokenDef[] = [
  { key: "colors.background", cssVar: "--background", group: "colors", kind: "color", doc: "App canvas." },
  { key: "colors.foreground", cssVar: "--foreground", group: "colors", kind: "textColor", doc: "Primary text on the canvas." },
  { key: "colors.card", cssVar: "--card", group: "colors", kind: "color", deps: ["colors.background"], derive: (d) => d["colors.background"], doc: "Raised surface. Falls back to the canvas." },
  { key: "colors.cardForeground", cssVar: "--card-foreground", group: "colors", kind: "textColor", deps: ["colors.foreground", "colors.background"], derive: (d) => { const v = d["colors.foreground"]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Text on card surfaces." },
  { key: "colors.popover", cssVar: "--popover", group: "colors", kind: "color", doc: "Popover surface." },
  { key: "colors.popoverForeground", cssVar: "--popover-foreground", group: "colors", kind: "textColor", doc: "Text on popover surfaces." },
  { key: "colors.primary", cssVar: "--primary", group: "colors", kind: "color", doc: "Primary accent color." },
  { key: "colors.primaryForeground", cssVar: "--primary-foreground", group: "colors", kind: "textColor", doc: "Text on primary color." },
  { key: "colors.secondary", cssVar: "--secondary", group: "colors", kind: "color", doc: "Secondary accent color." },
  { key: "colors.secondaryForeground", cssVar: "--secondary-foreground", group: "colors", kind: "textColor", doc: "Text on secondary color." },
  { key: "colors.muted", cssVar: "--muted", group: "colors", kind: "color", doc: "Muted surface." },
  { key: "colors.mutedForeground", cssVar: "--muted-foreground", group: "colors", kind: "textColor", doc: "Text on muted surfaces." },
  { key: "colors.accent", cssVar: "--accent", group: "colors", kind: "color", doc: "Accent color." },
  { key: "colors.accentForeground", cssVar: "--accent-foreground", group: "colors", kind: "textColor", doc: "Text on accent color." },
  { key: "colors.destructive", cssVar: "--destructive", group: "colors", kind: "color", doc: "Destructive action color." },
  { key: "colors.border", cssVar: "--border", group: "colors", kind: "color", doc: "Default border color." },
  { key: "colors.input", cssVar: "--input", group: "colors", kind: "color", doc: "Input border color." },
  { key: "colors.ring", cssVar: "--ring", group: "colors", kind: "color", doc: "Focus ring color." },
  { key: "colors.sidebar", cssVar: "--sidebar", group: "colors", kind: "color", doc: "Sidebar background." },
  { key: "colors.sidebarForeground", cssVar: "--sidebar-foreground", group: "colors", kind: "textColor", doc: "Sidebar text." },
  { key: "colors.sidebarPrimary", cssVar: "--sidebar-primary", group: "colors", kind: "color", doc: "Sidebar primary accent." },
  { key: "colors.sidebarPrimaryForeground", cssVar: "--sidebar-primary-foreground", group: "colors", kind: "textColor", doc: "Text on sidebar primary." },
  { key: "colors.sidebarAccent", cssVar: "--sidebar-accent", group: "colors", kind: "color", doc: "Sidebar accent." },
  { key: "colors.sidebarAccentForeground", cssVar: "--sidebar-accent-foreground", group: "colors", kind: "textColor", doc: "Text on sidebar accent." },
  { key: "colors.sidebarBorder", cssVar: "--sidebar-border", group: "colors", kind: "color", doc: "Sidebar border." },
  { key: "colors.sidebarRing", cssVar: "--sidebar-ring", group: "colors", kind: "color", doc: "Sidebar focus ring." },
  { key: "colors.radius", cssVar: "--radius", group: "colors", kind: "length", doc: "Border radius." },
  { key: "colors.borderStyle", cssVar: "--border-style", group: "colors", kind: "keyword", doc: "Border style." },

  { key: "shape.frameWidth", cssVar: "--frame-border-width", group: "shape", kind: "length", fallback: "1px", doc: "Frame border width." },
  { key: "shape.frameRadius", cssVar: "--frame-radius", group: "shape", kind: "length", fallback: "12px", doc: "Frame border radius." },
  { key: "shape.framePadding", cssVar: "--frame-padding", group: "shape", kind: "length", fallback: "0px", doc: "Frame padding." },
  { key: "shape.chromeWidth", cssVar: "--chrome-border-width", group: "shape", kind: "length", fallback: "1px", doc: "Chrome border width." },
  { key: "shape.panelWidth", cssVar: "--panel-border-width", group: "shape", kind: "length", fallback: "1px", doc: "Panel border width." },
  { key: "shape.slotWidth", cssVar: "--slot-border-width", group: "shape", kind: "length", fallback: "1px", doc: "Slot border width." },
  { key: "shape.controlWidth", cssVar: "--control-border-width", group: "shape", kind: "length", fallback: "1px", doc: "Control border width." },
  { key: "shape.bevelWidth", cssVar: "--bevel-width", group: "shape", kind: "length", fallback: "0px", doc: "Bevel width." },
  { key: "shape.bevelOuter", cssVar: "--bevel-outer", group: "shape", kind: "color", fallback: "transparent", doc: "Bevel outer color." },
  { key: "shape.bevelMid", cssVar: "--bevel-mid", group: "shape", kind: "color", fallback: "transparent", doc: "Bevel mid color." },
  { key: "shape.bevelInner", cssVar: "--bevel-inner", group: "shape", kind: "color", fallback: "transparent", doc: "Bevel inner color." },
  { key: "shape.liftColor", cssVar: "--lift-color", group: "shape", kind: "color", fallback: "transparent", doc: "Lift shadow color." },
  { key: "shape.liftDepth", cssVar: "--lift-depth", group: "shape", kind: "length", fallback: "0px", doc: "Lift depth." },
  { key: "shape.spacing", cssVar: "--ui-spacing", group: "shape", kind: "length", fallback: "0.25rem", doc: "UI spacing." },

  { key: "type.sans", cssVar: "--ui-font-sans", group: "type", kind: "keyword", doc: "Sans serif font." },
  { key: "type.mono", cssVar: "--ui-font-mono", group: "type", kind: "keyword", doc: "Monospace font." },
  { key: "type.display", cssVar: "--ui-font-display", group: "type", kind: "keyword", doc: "Display font." },
  { key: "type.chromeTracking", cssVar: "--chrome-tracking", group: "type", kind: "length", doc: "Chrome letter spacing." },
  { key: "type.chromeTransform", cssVar: "--chrome-transform", group: "type", kind: "keyword", doc: "Chrome text transform." },

  { key: "terminal.background", cssVar: "--terminal-background", group: "terminal", kind: "color", doc: "Terminal background." },
  { key: "terminal.foreground", cssVar: "--terminal-foreground", group: "terminal", kind: "textColor", doc: "Terminal foreground." },
  { key: "terminal.cursor", cssVar: "--terminal-cursor", group: "terminal", kind: "color", doc: "Terminal cursor." },
  { key: "terminal.cursorAccent", cssVar: "--terminal-cursor-accent", group: "terminal", kind: "color", doc: "Terminal cursor accent." },
  { key: "terminal.selection", cssVar: "--terminal-selection", group: "terminal", kind: "color", doc: "Terminal selection." },

  { key: "terminal.ansiBlack", cssVar: "--terminal-ansi-black", group: "terminal", kind: "color", doc: "ANSI Black." },
  { key: "terminal.ansiRed", cssVar: "--terminal-ansi-red", group: "terminal", kind: "color", doc: "ANSI Red." },
  { key: "terminal.ansiGreen", cssVar: "--terminal-ansi-green", group: "terminal", kind: "color", doc: "ANSI Green." },
  { key: "terminal.ansiYellow", cssVar: "--terminal-ansi-yellow", group: "terminal", kind: "color", doc: "ANSI Yellow." },
  { key: "terminal.ansiBlue", cssVar: "--terminal-ansi-blue", group: "terminal", kind: "color", doc: "ANSI Blue." },
  { key: "terminal.ansiMagenta", cssVar: "--terminal-ansi-magenta", group: "terminal", kind: "color", doc: "ANSI Magenta." },
  { key: "terminal.ansiCyan", cssVar: "--terminal-ansi-cyan", group: "terminal", kind: "color", doc: "ANSI Cyan." },
  { key: "terminal.ansiWhite", cssVar: "--terminal-ansi-white", group: "terminal", kind: "color", doc: "ANSI White." },
  { key: "terminal.ansiBrightBlack", cssVar: "--terminal-ansi-bright-black", group: "terminal", kind: "color", doc: "ANSI Bright Black." },
  { key: "terminal.ansiBrightRed", cssVar: "--terminal-ansi-bright-red", group: "terminal", kind: "color", doc: "ANSI Bright Red." },
  { key: "terminal.ansiBrightGreen", cssVar: "--terminal-ansi-bright-green", group: "terminal", kind: "color", doc: "ANSI Bright Green." },
  { key: "terminal.ansiBrightYellow", cssVar: "--terminal-ansi-bright-yellow", group: "terminal", kind: "color", doc: "ANSI Bright Yellow." },
  { key: "terminal.ansiBrightBlue", cssVar: "--terminal-ansi-bright-blue", group: "terminal", kind: "color", doc: "ANSI Bright Blue." },
  { key: "terminal.ansiBrightMagenta", cssVar: "--terminal-ansi-bright-magenta", group: "terminal", kind: "color", doc: "ANSI Bright Magenta." },
  { key: "terminal.ansiBrightCyan", cssVar: "--terminal-ansi-bright-cyan", group: "terminal", kind: "color", doc: "ANSI Bright Cyan." },
  { key: "terminal.ansiBrightWhite", cssVar: "--terminal-ansi-bright-white", group: "terminal", kind: "color", doc: "ANSI Bright White." },

  { key: "syntax.comment", cssVar: "--syntax-comment", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[8]; return v ? ensureContrast(v, d["colors.background"] || "#000", 3) : undefined; }, doc: "Comment color." },
  { key: "syntax.keyword", cssVar: "--syntax-keyword", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[5]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Keyword color." },
  { key: "syntax.string", cssVar: "--syntax-string", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[2]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "String color." },
  { key: "syntax.number", cssVar: "--syntax-number", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[3]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Number color." },
  { key: "syntax.constant", cssVar: "--syntax-constant", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[13]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Constant color." },
  { key: "syntax.func", cssVar: "--syntax-func", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[4]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Function color." },
  { key: "syntax.variable", cssVar: "--syntax-variable", group: "syntax", kind: "color", deps: ["colors.foreground", "colors.background"], derive: (d) => { const v = d["colors.foreground"]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Variable color." },
  { key: "syntax.property", cssVar: "--syntax-property", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[6]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Property color." },
  { key: "syntax.gutterFg", cssVar: "--syntax-gutter-fg", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[8]; return v ? ensureContrast(v, d["colors.background"] || "#000", 3) : undefined; }, doc: "Gutter foreground color." },
  { key: "syntax.type", cssVar: "--syntax-type", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[14]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Type color." },
  { key: "syntax.operator", cssVar: "--syntax-operator", group: "syntax", kind: "color", deps: ["colors.foreground", "colors.background"], derive: (d) => { const v = d["colors.foreground"]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Operator color." },
  { key: "syntax.tag", cssVar: "--syntax-tag", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[1]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Tag color." },
  { key: "syntax.tagBracket", cssVar: "--syntax-tag-bracket", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[8]; return v ? ensureContrast(v, d["colors.background"] || "#000", 3) : undefined; }, doc: "Tag bracket color." },
  { key: "syntax.attr", cssVar: "--syntax-attr", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[11]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Attribute color." },
  { key: "syntax.attrValue", cssVar: "--syntax-attr-value", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[2]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Attribute value color." },
  { key: "syntax.heading", cssVar: "--syntax-heading", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[4]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Heading color." },
  { key: "syntax.link", cssVar: "--syntax-link", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[6]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Link color." },
  { key: "syntax.invalid", cssVar: "--syntax-invalid", group: "syntax", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[9]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Invalid token color." },

  { key: "status.added", cssVar: "--status-added", group: "status", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[2]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Added status color." },
  { key: "status.modified", cssVar: "--status-modified", group: "status", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[3]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Modified status color." },
  { key: "status.deleted", cssVar: "--status-deleted", group: "status", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[1]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Deleted status color." },
  { key: "status.renamed", cssVar: "--status-renamed", group: "status", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[4]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Renamed status color." },
  { key: "status.warning", cssVar: "--status-warning", group: "status", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[3]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Warning status color." },
  { key: "status.conflict", cssVar: "--status-conflict", group: "status", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[6]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "Conflict status color." },
  { key: "status.ok", cssVar: "--status-ok", group: "status", kind: "color", deps: ["colors.background"], derive: (d) => { const v = d.ansi?.[2]; return v ? ensureContrast(v, d["colors.background"] || "#000", 4.5) : undefined; }, doc: "OK status color." },
];
