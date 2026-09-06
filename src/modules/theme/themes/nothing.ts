import type { Theme } from "../types";

// Nothing OS: monochrome void, one red signal, dots you can actually see.
//
// The theme has always described itself correctly and rendered something else.
// This pass fixes the three claims in its own description rather than restyling
// it, so the values below are deliberate in ways that look arbitrary:
//
// The dots need 2px. `borderStyle: "dotted"` does reach every border already
// (globals.css puts `border-style: var(--border-style)` on `*` in both the base
// and utilities layers), so scope was never the problem. Width was: at 1px, CSS
// dotted paints 1px dots separated by 1px gaps and is indistinguishable from a
// fainter solid line. 2px plus a border that clears 3:1 is what makes the
// texture appear, and `emphasis.strong` at 100% is what stops the chrome from
// drawing that border at 60% alpha.
//
// The palette is near-monochrome on purpose. The previous one peaked at 76%
// saturation on brightYellow, which is a muted colour palette, not the
// "monochrome void" the description promises. Hue now sits at the threshold of
// perception and lightness carries the separation, so the slots still
// differentiate and blue still differs from cyan. Red is the only saturated
// colour on screen. Because syntax derives from the ansi palette, this is also
// what makes the editor monochrome.
//
// `syntax.tag` is pinned off slot 1. Left to derive it would inherit the red,
// and in a theme where red means "attention" every tag in every file would fire
// the signal. `invalid`, `status.deleted` and `destructive` still derive.
export const nothing: Theme = {
  id: "nothing",
  name: "Nothing",
  description: "Monochrome void, dot-matrix type, one red signal.",
  editorTheme: {
    light: "github-light",
    dark: "kanagawa",
  },
  variants: {
    dark: {
      colors: {
        background: "#0a0a0a",
        foreground: "#ededeb",
        card: "#141414",
        cardForeground: "#ededeb",
        popover: "#1a1a1a",
        popoverForeground: "#ededeb",
        primary: "#d63b2e",
        primaryForeground: "#ffffff",
        secondary: "#1a1a1a",
        secondaryForeground: "#ededeb",
        muted: "#141414",
        mutedForeground: "#9a9a96",
        accent: "#1f1f1f",
        accentForeground: "#ededeb",
        destructive: "#d63b2e",
        // Lifted from #3a3a3a, which was too dim for the dots to register.
        border: "#6e6e6a",
        input: "#6e6e6a",
        ring: "#d63b2e",
        radius: "0.25rem",
        borderStyle: "dotted",
        sidebar: "#000000",
        sidebarForeground: "#ededeb",
        sidebarPrimary: "#d63b2e",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#1f1f1f",
        sidebarAccentForeground: "#ededeb",
        sidebarBorder: "#6e6e6a",
        sidebarRing: "#d63b2e",
      },
      emphasis: {
        faint: "12%",
        subtle: "32%",
        soft: "45%",
        medium: "60%",
        strong: "100%",
        bold: "100%",
      },
      terminal: {
        background: "#0a0a0a",
        foreground: "#ededeb",
        cursor: "#d63b2e",
        cursorAccent: "#ffffff",
        selection: "rgba(214, 59, 46, 0.30)",
        ansi: [
          "#1e1e1e",
          "#e5342a",
          "#b6b6b3",
          "#d2cfc7",
          "#909aa2",
          "#c0b7bc",
          "#a8afaf",
          "#e8e8e6",
          "#7a7a76",
          "#ff5347",
          "#cfcfcc",
          "#e9e6dc",
          "#a9afb9",
          "#d8ced3",
          "#bfc7c7",
          "#ffffff",
        ],
      },
      syntax: {
        tag: "#a8afaf",
      },
      shape: {
        frameWidth: "2px",
        frameRadius: "10px",
        chromeWidth: "2px",
        panelWidth: "2px",
      },
      type: { chromeTracking: "0.14em", chromeTransform: "uppercase" },
    },
    light: {
      colors: {
        background: "#fafaf9",
        foreground: "#0a0a0a",
        card: "#ffffff",
        cardForeground: "#0a0a0a",
        popover: "#ffffff",
        popoverForeground: "#0a0a0a",
        primary: "#c8342a",
        primaryForeground: "#ffffff",
        secondary: "#f0f0ee",
        secondaryForeground: "#0a0a0a",
        muted: "#f0f0ee",
        mutedForeground: "#5c5c58",
        accent: "#eaeae8",
        accentForeground: "#0a0a0a",
        destructive: "#c8342a",
        // Lifted from #b8b8b8, same reason as dark.
        border: "#8a8a86",
        input: "#8a8a86",
        ring: "#c8342a",
        radius: "0.25rem",
        borderStyle: "dotted",
        sidebar: "#f0f0ee",
        sidebarForeground: "#0a0a0a",
        sidebarPrimary: "#c8342a",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#eaeae8",
        sidebarAccentForeground: "#0a0a0a",
        sidebarBorder: "#8a8a86",
        sidebarRing: "#c8342a",
      },
      emphasis: {
        faint: "12%",
        subtle: "32%",
        soft: "45%",
        medium: "60%",
        strong: "100%",
        bold: "100%",
      },
      terminal: {
        background: "#fafaf9",
        foreground: "#0a0a0a",
        cursor: "#c8342a",
        cursorAccent: "#ffffff",
        selection: "rgba(200, 52, 42, 0.22)",
        ansi: [
          "#0a0a0a",
          "#c42419",
          "#55554f",
          "#6e6a5c",
          "#4a5058",
          "#6a5a60",
          "#56605e",
          "#2e2e2a",
          "#6e6e68",
          "#e5342a",
          "#74746e",
          "#8a8578",
          "#6a7280",
          "#8a7a82",
          "#78827e",
          "#141414",
        ],
      },
      syntax: {
        tag: "#56605e",
      },
      shape: {
        frameWidth: "2px",
        frameRadius: "10px",
        chromeWidth: "2px",
        panelWidth: "2px",
      },
      type: { chromeTracking: "0.14em", chromeTransform: "uppercase" },
    },
  },
};
