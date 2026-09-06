import type { Theme } from "../types";

// Terra Default: warm graphite, one ember, a terminal painted in pigments.
//
// This is the theme most people never change, so it is authored as an identity
// rather than as a neutral baseline. Three decisions carry it:
//
// - The chrome sits on a warm neutral axis (hue 68, chroma under 0.01) instead
//   of the blue slate every shadcn scaffold ships. It reads as graphite next to
//   a terminal, and it is the one thing on screen that must never compete with
//   the terminal.
// - Exactly one hue is allowed to mean something. Ember carries primary, ring,
//   the folder glyphs and the terminal cursor, so a saturated pixel in the
//   chrome always points at an action. Everything else is neutral.
// - The ANSI palette is a set of earth pigments (clay, sage, wheat, steel,
//   rosewood, verdigris) rather than screen primaries, authored at even
//   lightness and chroma per row so the sixteen read as one palette. Since
//   `syntax` and `status` derive from these slots, the editor, the diff marks
//   and the agent state bars inherit the same pigments for free.
//
// Chrome colours stay in oklch so this file and the globals.css pre-hydration
// block remain trivially comparable; the terminal palette is hex because
// readTerminalTokens round-trips values through getComputedStyle into xterm,
// which parses hex and rgb but is not obliged to parse oklch.
//
// Identity is not only colour. The radius drops to 8px and `pillRadius` to 6px,
// so chips, badges and switches are soft squares rather than lozenges and the
// app reads as an instrument panel; motion runs snappy because a tool that
// fronts a terminal should feel instant; the shadow tint is warm so depth does
// not go grey against the surfaces above.
export const terraDefault: Theme = {
  id: "terra-default",
  name: "Terra Default",
  description: "Warm graphite, one ember, a terminal in earth pigments.",
  variants: {
    dark: {
      colors: {
        background: "oklch(0.188 0.006 68)",
        foreground: "oklch(0.926 0.006 84)",
        card: "oklch(0.229 0.007 68)",
        cardForeground: "oklch(0.926 0.006 84)",
        popover: "oklch(0.253 0.0075 68)",
        popoverForeground: "oklch(0.926 0.006 84)",
        primary: "oklch(0.705 0.145 47)",
        primaryForeground: "oklch(0.185 0.02 55)",
        secondary: "oklch(0.274 0.008 68)",
        secondaryForeground: "oklch(0.926 0.006 84)",
        muted: "oklch(0.274 0.008 68)",
        mutedForeground: "oklch(0.7 0.012 78)",
        accent: "oklch(0.274 0.008 68)",
        accentForeground: "oklch(0.926 0.006 84)",
        destructive: "oklch(0.66 0.18 26)",
        border: "oklch(0.345 0.009 68)",
        input: "oklch(0.385 0.01 68)",
        ring: "oklch(0.7 0.14 47)",
        radius: "0.5rem",
        borderStyle: "solid",
      },
      // Raised against the stock ladder: the rule is an opaque warm grey rather
      // than a white wash, so it needs less alpha taken off it to sit right.
      emphasis: {
        faint: "12%",
        subtle: "32%",
        soft: "44%",
        medium: "56%",
        strong: "72%",
        bold: "90%",
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "11px",
        framePadding: "0px",
        chromeWidth: "1px",
        panelWidth: "1px",
        pillRadius: "6px",
        // One hairline ring inside the window edge, so the frame catches light
        // the way the surfaces below it do not.
        bevelWidth: "1px",
        bevelOuter: "oklch(0.3 0.008 68)",
        bevelMid: "transparent",
        bevelInner: "transparent",
      },
      type: { chromeTracking: "0.03em" },
      motion: { speed: "snappy", easing: "expressive" },
      effects: { shadow: "rgb(10 6 3 / 0.34)", blur: "on" },
      icons: "nerd",
      terminal: {
        background: "#151311",
        foreground: "#e0deda",
        cursor: "#e8804a",
        cursorAccent: "#151311",
        selection: "rgba(232,128,74,0.22)",
        ansi: [
          "#272420",
          "#e8796c",
          "#7ab67b",
          "#d5aa55",
          "#70a4d0",
          "#c588b0",
          "#63b4b5",
          "#c0bdb8",
          "#7e7871",
          "#fa9e92",
          "#9bd69c",
          "#f3cb7a",
          "#92c4ee",
          "#e4a9cf",
          "#88d4d4",
          "#f2f0ec",
        ],
      },
    },
    light: {
      colors: {
        background: "oklch(0.97 0.004 85)",
        foreground: "oklch(0.215 0.01 60)",
        card: "oklch(0.99 0.003 85)",
        cardForeground: "oklch(0.215 0.01 60)",
        popover: "oklch(0.995 0.002 85)",
        popoverForeground: "oklch(0.215 0.01 60)",
        primary: "oklch(0.545 0.155 45)",
        primaryForeground: "oklch(0.985 0.004 85)",
        secondary: "oklch(0.94 0.006 82)",
        secondaryForeground: "oklch(0.215 0.01 60)",
        muted: "oklch(0.94 0.006 82)",
        mutedForeground: "oklch(0.505 0.016 68)",
        accent: "oklch(0.94 0.006 82)",
        accentForeground: "oklch(0.215 0.01 60)",
        destructive: "oklch(0.53 0.2 27)",
        border: "oklch(0.855 0.009 80)",
        input: "oklch(0.8 0.011 80)",
        ring: "oklch(0.6 0.145 45)",
        radius: "0.5rem",
        borderStyle: "solid",
      },
      emphasis: {
        faint: "12%",
        subtle: "32%",
        soft: "44%",
        medium: "56%",
        strong: "72%",
        bold: "90%",
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "11px",
        framePadding: "0px",
        chromeWidth: "1px",
        panelWidth: "1px",
        pillRadius: "6px",
        bevelWidth: "1px",
        bevelOuter: "oklch(1 0 0)",
        bevelMid: "transparent",
        bevelInner: "transparent",
      },
      type: { chromeTracking: "0.03em" },
      motion: { speed: "snappy", easing: "expressive" },
      effects: { shadow: "rgb(84 60 38 / 0.13)", blur: "on" },
      icons: "nerd",
      // Paper, not white: the canvas comes off pure white so the raised card
      // surfaces have something to sit on, and the pigments below are mixed for
      // that ground rather than for a screen.
      terminal: {
        background: "#f6f5f2",
        foreground: "#231e1b",
        cursor: "#b64a02",
        cursorAccent: "#f6f5f2",
        selection: "rgba(182,74,2,0.16)",
        ansi: [
          "#d3cfc8",
          "#a8372e",
          "#326d36",
          "#8b5f00",
          "#2b6399",
          "#8a4375",
          "#006f70",
          "#4b4742",
          "#817b73",
          "#8a1d18",
          "#1f5323",
          "#674809",
          "#124a7b",
          "#6b2d59",
          "#035353",
          "#25211b",
        ],
      },
    },
  },
};
