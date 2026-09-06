import type { Theme } from "../types";

// Kanagawa: Hokusai's wave in ink, with the warm Lotus paper as its light side.
//
// This was a transcription of the upstream palette, which meant it inherited
// upstream's contrast problems and, because it declared no terminal background,
// sat outside the legibility guard entirely. The corrections here move OKLab
// lightness only, so hue and chroma stay upstream's: autumnRed at 3.22:1 on the
// ink is the same red, just far enough off the background to read.
//
// Two changes are larger than a nudge and are deliberate:
//
// - Lotus declares its own terminal background. The canvas #f2ecbc is near 67%
//   HSL saturation, well past the ~25% THEME.md asks for, and since an
//   undeclared terminal background inherits the canvas it was casting yellow
//   across all sixteen slots. The terminal sits on a chroma-reduced cream that
//   is still the same paper.
// - Lotus's mutedForeground was 2.93:1 on the canvas and 2.56:1 on card, the
//   worst pair in the whole set of builtins. Secondary text is not decoration.
//
// brightRed on the dark side becomes peachRed, which is upstream's own, because
// raising autumnRed to floor pushed it past samuraiRed and inverted the pair.
//
// Surfaces stay close in tone and the border does the separating, per THEME.md.
// That is why the 8% and 14% alpha washes are gone: an ink-wash theme still
// needs an edge you can actually see.
export const kanagawa: Theme = {
  id: "kanagawa",
  name: "Kanagawa",
  description: "Inky dark inspired by Hokusai; warm Lotus light.",
  variants: {
    dark: {
      colors: {
        background: "#1f1f28",
        foreground: "#dcd7ba",
        card: "#16161d",
        cardForeground: "#dcd7ba",
        popover: "#16161d",
        popoverForeground: "#dcd7ba",
        primary: "#7e9cd8",
        primaryForeground: "#1f1f28",
        secondary: "#2a2a37",
        secondaryForeground: "#dcd7ba",
        muted: "#2a2a37",
        mutedForeground: "#a09f96",
        accent: "#363646",
        accentForeground: "#dcd7ba",
        destructive: "#c34043",
        border: "#38384a",
        input: "#4a4a5e",
        ring: "#7e9cd8",
        radius: "0.5rem",
        borderStyle: "solid",
      },
      emphasis: {
        faint: "12%",
        subtle: "35%",
        soft: "45%",
        medium: "55%",
        strong: "68%",
        bold: "90%",
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "12px",
        framePadding: "0px",
        chromeWidth: "1px",
        panelWidth: "1px",
        bevelWidth: "1px",
        bevelOuter: "#2a2a37",
        bevelMid: "transparent",
        bevelInner: "transparent",
      },
      terminal: {
        background: "#1f1f28",
        foreground: "#dcd7ba",
        cursor: "#c8c093",
        cursorAccent: "#1f1f28",
        selection: "rgba(45,79,103,0.45)",
        ansi: [
          "#090618",
          "#e25c5c",
          "#76946a",
          "#c0a36e",
          "#7e9cd8",
          "#957fb8",
          "#6a9589",
          "#c8c093",
          "#727169",
          "#ff5d62",
          "#98bb6c",
          "#e6c384",
          "#7fb4ca",
          "#938aa9",
          "#7aa89f",
          "#dcd7ba",
        ],
      },
    },
    light: {
      colors: {
        background: "#f2ecbc",
        foreground: "#545464",
        card: "#e5ddb0",
        cardForeground: "#545464",
        popover: "#e5ddb0",
        popoverForeground: "#545464",
        primary: "#4d699b",
        primaryForeground: "#f2ecbc",
        secondary: "#e5ddb0",
        secondaryForeground: "#545464",
        muted: "#e5ddb0",
        mutedForeground: "#616058",
        accent: "#dcd5ac",
        accentForeground: "#545464",
        destructive: "#c84053",
        border: "#c5bd90",
        input: "#b3aa7d",
        ring: "#4d699b",
        radius: "0.5rem",
        borderStyle: "solid",
      },
      emphasis: {
        faint: "12%",
        subtle: "35%",
        soft: "45%",
        medium: "55%",
        strong: "68%",
        bold: "90%",
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "12px",
        framePadding: "0px",
        chromeWidth: "1px",
        panelWidth: "1px",
        bevelWidth: "1px",
        bevelOuter: "#e7e1b6",
        bevelMid: "transparent",
        bevelInner: "transparent",
      },
      terminal: {
        background: "#eceadf",
        foreground: "#545464",
        cursor: "#43436c",
        cursorAccent: "#eceadf",
        selection: "rgba(200,190,140,0.55)",
        ansi: [
          "#1f1f28",
          "#bd354a",
          "#577036",
          "#706938",
          "#4d689a",
          "#a24c6a",
          "#4d6e69",
          "#545464",
          "#85847c",
          "#d7474b",
          "#6b8d5c",
          "#836f4a",
          "#5b87b3",
          "#624c83",
          "#5e857a",
          "#43436c",
        ],
      },
    },
  },
};
