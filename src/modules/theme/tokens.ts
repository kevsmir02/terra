import { contrast, ensureContrast } from "./oklab";

export type TokenKind = "color" | "textColor" | "length" | "keyword" | "alpha";

/**
 * Status text lands on the app canvas and on card surfaces both. When the two
 * surfaces sit on opposite sides of the luminance midpoint no single lightness
 * clears 4.5:1 against each, so the canvas wins as the larger surface.
 */
function statusColor(slot: number) {
  return (d: DerivedValues): string | undefined => {
    const base = d.ansi?.[slot];
    const bg = d["colors.background"];
    if (!base || !bg) return base;
    const onCanvas = ensureContrast(base, bg, 4.5);
    const card = d["colors.card"];
    if (!card) return onCanvas;
    const withCard = ensureContrast(onCanvas, card, 4.5);
    return contrast(withCard, bg) >= 4.5 ? withCard : onCanvas;
  };
}

export type DerivedValues = Readonly<Record<string, string | undefined>> & {
  readonly ansi?: readonly string[];
};

export type TokenDef = {
  /** Dotted path into the variant, e.g. "colors.background". */
  key: string;
  cssVar: string;
  group:
    | "colors"
    | "terminal"
    | "shape"
    | "type"
    | "effects"
    | "motion"
    | "syntax"
    | "status"
    | "emphasis";
  kind: TokenKind;
  /** Keys `derive` reads. Drives the topological order. */
  deps?: readonly string[];
  derive?: (d: DerivedValues) => string | undefined;
  fallback?: string;
  /** Rewrites an authored keyword into the CSS value the variable carries. */
  map?: Readonly<Record<string, string>>;
};

export const TOKENS: readonly TokenDef[] = [
  {
    key: "colors.background",
    cssVar: "--background",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.foreground",
    cssVar: "--foreground",
    group: "colors",
    kind: "textColor",
  },
  {
    key: "colors.card",
    cssVar: "--card",
    group: "colors",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => d["colors.background"],
  },
  {
    key: "colors.cardForeground",
    cssVar: "--card-foreground",
    group: "colors",
    kind: "textColor",
    deps: ["colors.foreground", "colors.background"],
    derive: (d) => {
      const v = d["colors.foreground"];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "colors.popover",
    cssVar: "--popover",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.popoverForeground",
    cssVar: "--popover-foreground",
    group: "colors",
    kind: "textColor",
  },
  {
    key: "colors.primary",
    cssVar: "--primary",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.primaryForeground",
    cssVar: "--primary-foreground",
    group: "colors",
    kind: "textColor",
  },
  {
    key: "colors.secondary",
    cssVar: "--secondary",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.secondaryForeground",
    cssVar: "--secondary-foreground",
    group: "colors",
    kind: "textColor",
  },
  {
    key: "colors.muted",
    cssVar: "--muted",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.mutedForeground",
    cssVar: "--muted-foreground",
    group: "colors",
    kind: "textColor",
  },
  {
    key: "colors.accent",
    cssVar: "--accent",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.accentForeground",
    cssVar: "--accent-foreground",
    group: "colors",
    kind: "textColor",
  },
  {
    key: "colors.destructive",
    cssVar: "--destructive",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.border",
    cssVar: "--border",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.input",
    cssVar: "--input",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.ring",
    cssVar: "--ring",
    group: "colors",
    kind: "color",
  },
  {
    key: "colors.radius",
    cssVar: "--radius",
    group: "colors",
    kind: "length",
  },
  {
    key: "colors.borderStyle",
    cssVar: "--border-style",
    group: "colors",
    kind: "keyword",
  },

  {
    key: "shape.frameWidth",
    cssVar: "--frame-border-width",
    group: "shape",
    kind: "length",
    fallback: "1px",
  },
  {
    key: "shape.frameRadius",
    cssVar: "--frame-radius",
    group: "shape",
    kind: "length",
    fallback: "12px",
  },
  {
    key: "shape.framePadding",
    cssVar: "--frame-padding",
    group: "shape",
    kind: "length",
    fallback: "0px",
  },
  {
    key: "shape.chromeWidth",
    cssVar: "--chrome-border-width",
    group: "shape",
    kind: "length",
    fallback: "1px",
  },
  {
    key: "shape.panelWidth",
    cssVar: "--panel-border-width",
    group: "shape",
    kind: "length",
    fallback: "1px",
  },
  {
    key: "shape.slotWidth",
    cssVar: "--slot-border-width",
    group: "shape",
    kind: "length",
    fallback: "1px",
  },
  {
    key: "shape.bevelWidth",
    cssVar: "--bevel-width",
    group: "shape",
    kind: "length",
    fallback: "0px",
  },
  {
    key: "shape.bevelOuter",
    cssVar: "--bevel-outer",
    group: "shape",
    kind: "color",
    fallback: "transparent",
  },
  {
    key: "shape.bevelMid",
    cssVar: "--bevel-mid",
    group: "shape",
    kind: "color",
    fallback: "transparent",
  },
  {
    key: "shape.bevelInner",
    cssVar: "--bevel-inner",
    group: "shape",
    kind: "color",
    fallback: "transparent",
  },
  {
    key: "shape.spacing",
    cssVar: "--ui-spacing",
    group: "shape",
    kind: "length",
    fallback: "0.25rem",
  },
  {
    key: "shape.pillRadius",
    cssVar: "--radius-pill",
    group: "shape",
    kind: "length",
    fallback: "9999px",
  },

  {
    key: "effects.shadow",
    cssVar: "--fx-shadow-color",
    group: "effects",
    kind: "color",
  },
  {
    key: "effects.blur",
    cssVar: "--fx-blur-factor",
    group: "effects",
    kind: "keyword",
    map: { on: "1", off: "0" },
    fallback: "1",
  },

  {
    key: "motion.speed",
    cssVar: "--motion-scale",
    group: "motion",
    kind: "keyword",
    map: {
      instant: "0",
      snappy: "0.72",
      smooth: "1",
      relaxed: "1.35",
    },
    fallback: "1",
  },
  {
    key: "motion.easing",
    cssVar: "--motion-ease",
    group: "motion",
    kind: "keyword",
    map: {
      mechanical: "linear",
      standard: "cubic-bezier(0.32, 0.72, 0, 1)",
      expressive: "cubic-bezier(0.16, 1, 0.3, 1)",
    },
    fallback: "cubic-bezier(0.32, 0.72, 0, 1)",
  },

  {
    key: "type.chromeTracking",
    cssVar: "--chrome-tracking",
    group: "type",
    kind: "length",
  },
  {
    key: "type.chromeTransform",
    cssVar: "--chrome-transform",
    group: "type",
    kind: "keyword",
  },

  {
    key: "terminal.background",
    cssVar: "--terminal-background",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.foreground",
    cssVar: "--terminal-foreground",
    group: "terminal",
    kind: "textColor",
  },
  {
    key: "terminal.cursor",
    cssVar: "--terminal-cursor",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.cursorAccent",
    cssVar: "--terminal-cursor-accent",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.selection",
    cssVar: "--terminal-selection",
    group: "terminal",
    kind: "color",
  },

  {
    key: "terminal.ansiBlack",
    cssVar: "--terminal-ansi-black",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiRed",
    cssVar: "--terminal-ansi-red",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiGreen",
    cssVar: "--terminal-ansi-green",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiYellow",
    cssVar: "--terminal-ansi-yellow",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBlue",
    cssVar: "--terminal-ansi-blue",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiMagenta",
    cssVar: "--terminal-ansi-magenta",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiCyan",
    cssVar: "--terminal-ansi-cyan",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiWhite",
    cssVar: "--terminal-ansi-white",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBrightBlack",
    cssVar: "--terminal-ansi-bright-black",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBrightRed",
    cssVar: "--terminal-ansi-bright-red",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBrightGreen",
    cssVar: "--terminal-ansi-bright-green",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBrightYellow",
    cssVar: "--terminal-ansi-bright-yellow",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBrightBlue",
    cssVar: "--terminal-ansi-bright-blue",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBrightMagenta",
    cssVar: "--terminal-ansi-bright-magenta",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBrightCyan",
    cssVar: "--terminal-ansi-bright-cyan",
    group: "terminal",
    kind: "color",
  },
  {
    key: "terminal.ansiBrightWhite",
    cssVar: "--terminal-ansi-bright-white",
    group: "terminal",
    kind: "color",
  },

  {
    key: "syntax.comment",
    cssVar: "--syntax-comment",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[8];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 3)
        : undefined;
    },
  },
  {
    key: "syntax.keyword",
    cssVar: "--syntax-keyword",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[5];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.string",
    cssVar: "--syntax-string",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[2];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.number",
    cssVar: "--syntax-number",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[3];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.constant",
    cssVar: "--syntax-constant",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[13];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.func",
    cssVar: "--syntax-func",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[4];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.variable",
    cssVar: "--syntax-variable",
    group: "syntax",
    kind: "color",
    deps: ["colors.foreground", "colors.background"],
    derive: (d) => {
      const v = d["colors.foreground"];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.property",
    cssVar: "--syntax-property",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[6];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.gutterFg",
    cssVar: "--syntax-gutter-fg",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[8];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 3)
        : undefined;
    },
  },
  {
    key: "syntax.type",
    cssVar: "--syntax-type",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[14];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.operator",
    cssVar: "--syntax-operator",
    group: "syntax",
    kind: "color",
    deps: ["colors.foreground", "colors.background"],
    derive: (d) => {
      const v = d["colors.foreground"];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.tag",
    cssVar: "--syntax-tag",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[1];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.tagBracket",
    cssVar: "--syntax-tag-bracket",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[8];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 3)
        : undefined;
    },
  },
  {
    key: "syntax.attr",
    cssVar: "--syntax-attr",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[11];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.attrValue",
    cssVar: "--syntax-attr-value",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[2];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.heading",
    cssVar: "--syntax-heading",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[4];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.link",
    cssVar: "--syntax-link",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[6];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },
  {
    key: "syntax.invalid",
    cssVar: "--syntax-invalid",
    group: "syntax",
    kind: "color",
    deps: ["colors.background"],
    derive: (d) => {
      const v = d.ansi?.[9];
      return v
        ? ensureContrast(v, d["colors.background"] || "#000", 4.5)
        : undefined;
    },
  },

  {
    key: "status.added",
    cssVar: "--status-added",
    group: "status",
    kind: "color",
    deps: ["colors.background", "colors.card"],
    derive: statusColor(2),
  },
  {
    key: "status.modified",
    cssVar: "--status-modified",
    group: "status",
    kind: "color",
    deps: ["colors.background", "colors.card"],
    derive: statusColor(3),
  },
  {
    key: "status.deleted",
    cssVar: "--status-deleted",
    group: "status",
    kind: "color",
    deps: ["colors.background", "colors.card"],
    derive: statusColor(1),
  },
  {
    key: "status.renamed",
    cssVar: "--status-renamed",
    group: "status",
    kind: "color",
    deps: ["colors.background", "colors.card"],
    derive: statusColor(4),
  },
  {
    key: "status.warning",
    cssVar: "--status-warning",
    group: "status",
    kind: "color",
    deps: ["colors.background", "colors.card"],
    derive: statusColor(3),
  },
  {
    key: "status.conflict",
    cssVar: "--status-conflict",
    group: "status",
    kind: "color",
    deps: ["colors.background", "colors.card"],
    derive: statusColor(6),
  },
  {
    key: "status.ok",
    cssVar: "--status-ok",
    group: "status",
    kind: "color",
    deps: ["colors.background", "colors.card"],
    derive: statusColor(2),
  },

  {
    key: "emphasis.faint",
    cssVar: "--emph-faint",
    group: "emphasis",
    kind: "alpha",
    fallback: "10%",
  },
  {
    key: "emphasis.subtle",
    cssVar: "--emph-subtle",
    group: "emphasis",
    kind: "alpha",
    fallback: "30%",
  },
  {
    key: "emphasis.soft",
    cssVar: "--emph-soft",
    group: "emphasis",
    kind: "alpha",
    fallback: "40%",
  },
  {
    key: "emphasis.medium",
    cssVar: "--emph-medium",
    group: "emphasis",
    kind: "alpha",
    fallback: "50%",
  },
  {
    key: "emphasis.strong",
    cssVar: "--emph-strong",
    group: "emphasis",
    kind: "alpha",
    fallback: "60%",
  },
  {
    key: "emphasis.bold",
    cssVar: "--emph-bold",
    group: "emphasis",
    kind: "alpha",
    fallback: "85%",
  },
];
