import type { Theme } from "../types";

// Terra Default: the neutral, quiet baseline.
//
// This used to be `variants: { light: {}, dark: {} }` with ThemeProvider
// clearing the variables instead of applying any, so what shipped was whatever
// globals.css happened to hold: the untouched shadcn scaffold plus Tailwind's
// stock ANSI set on a pure white terminal, where yellow measured about 1.9:1.
// It was simultaneously the theme most users see and the only one no test could
// reach, because every guard keys off a resolved --background.
//
// The intent here is polish, not replacement. The chrome keeps its values and
// its colour space (oklch, so globals.css and this file stay trivially
// comparable). Two things do change:
//
// - The light canvas comes off pure white. Canvas and card were both
//   oklch(1 0 0), which left the header, statusbar and panel container with no
//   boundary at all. Card is now the raised white surface and the canvas sits
//   just under it, matching how the dark variant already stacks them.
// - mutedForeground is darkened. It cleared 4.5:1 only because it sat on pure
//   white; against the lifted canvas it measured 4.33:1.
//
// The terminal palette is authored rather than inherited, and is written in hex
// on purpose: readTerminalTokens round-trips values through getComputedStyle
// into xterm, which parses hex and rgb but is not obliged to parse oklch.
//
// Declaring ANSI also means the editor now derives its syntax roles from this
// palette instead of falling through to the atomone pairing. That is the engine
// working as designed: terminal and editor stop being two unrelated colour
// schemes, and every derived role is contrast-normalized against the canvas.
export const terraDefault: Theme = {
  id: "terra-default",
  name: "Terra Default",
  description: "The default Terra look - clean glass over neutral surfaces.",
  variants: {
    light: {
      colors: {
        background: "oklch(0.978 0.002 228.8)",
        foreground: "oklch(0.148 0.004 228.8)",
        card: "oklch(1 0 0)",
        cardForeground: "oklch(0.148 0.004 228.8)",
        popover: "oklch(1 0 0)",
        popoverForeground: "oklch(0.148 0.004 228.8)",
        primary: "oklch(0.218 0.008 223.9)",
        primaryForeground: "oklch(0.987 0.002 197.1)",
        secondary: "oklch(0.963 0.002 197.1)",
        secondaryForeground: "oklch(0.218 0.008 223.9)",
        muted: "oklch(0.963 0.002 197.1)",
        mutedForeground: "oklch(0.544 0.021 213.5)",
        accent: "oklch(0.963 0.002 197.1)",
        accentForeground: "oklch(0.218 0.008 223.9)",
        destructive: "oklch(0.577 0.245 27.325)",
        border: "oklch(0.925 0.005 214.3)",
        input: "oklch(0.925 0.005 214.3)",
        ring: "oklch(0.723 0.014 214.4)",
        radius: "0.625rem",
        borderStyle: "solid",
      },
      emphasis: {
        faint: "10%",
        subtle: "30%",
        soft: "40%",
        medium: "50%",
        strong: "60%",
        bold: "85%",
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "12px",
        framePadding: "0px",
        chromeWidth: "1px",
        panelWidth: "1px",
        bevelWidth: "0px",
      },
      motion: { speed: "smooth", easing: "expressive" },
      terminal: {
        background: "#f6f8f9",
        foreground: "#090b0c",
        cursor: "#090b0c",
        cursorAccent: "#f6f8f9",
        selection: "rgba(103,120,124,0.22)",
        ansi: [
          "#dfe3e6",
          "#c0392f",
          "#1f7a52",
          "#8a6100",
          "#1f66b0",
          "#7d47b5",
          "#10707a",
          "#4a5259",
          "#6e7880",
          "#9e2b24",
          "#17603f",
          "#6d4c00",
          "#17508a",
          "#62368f",
          "#0c5960",
          "#171a1d",
        ],
      },
    },
    dark: {
      colors: {
        background: "oklch(0.148 0.004 228.8)",
        foreground: "oklch(0.987 0.002 197.1)",
        card: "oklch(0.218 0.008 223.9)",
        cardForeground: "oklch(0.987 0.002 197.1)",
        popover: "oklch(0.218 0.008 223.9)",
        popoverForeground: "oklch(0.987 0.002 197.1)",
        primary: "oklch(0.925 0.005 214.3)",
        primaryForeground: "oklch(0.218 0.008 223.9)",
        secondary: "oklch(0.275 0.011 216.9)",
        secondaryForeground: "oklch(0.987 0.002 197.1)",
        muted: "oklch(0.275 0.011 216.9)",
        mutedForeground: "oklch(0.723 0.014 214.4)",
        accent: "oklch(0.275 0.011 216.9)",
        accentForeground: "oklch(0.987 0.002 197.1)",
        destructive: "oklch(0.704 0.191 22.216)",
        border: "oklch(1 0 0 / 10%)",
        input: "oklch(1 0 0 / 15%)",
        ring: "oklch(0.56 0.021 213.5)",
        radius: "0.625rem",
        borderStyle: "solid",
      },
      emphasis: {
        faint: "10%",
        subtle: "30%",
        soft: "40%",
        medium: "50%",
        strong: "60%",
        bold: "85%",
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "12px",
        framePadding: "0px",
        chromeWidth: "1px",
        panelWidth: "1px",
        bevelWidth: "0px",
      },
      motion: { speed: "smooth", easing: "expressive" },
      terminal: {
        background: "#090b0c",
        foreground: "#f9fbfb",
        cursor: "#f9fbfb",
        cursorAccent: "#090b0c",
        selection: "rgba(156,168,171,0.28)",
        ansi: [
          "#1b2124",
          "#e05561",
          "#62b47e",
          "#d3a04a",
          "#5aa2e0",
          "#b48ee0",
          "#4fb3bf",
          "#c8ced3",
          "#6b757d",
          "#ef7078",
          "#7ecb96",
          "#e6b866",
          "#77b8ee",
          "#c8a6ef",
          "#6ecad6",
          "#eef2f4",
        ],
      },
    },
  },
};
