import type { Theme } from "../types";

// Kanagawa Dragon: the muted, near-black variant. Ink that has dried.
//
// Upstream ships Dragon as dark-only, so light mode used to serve the dark
// palette and the mode toggle did nothing at all while this theme was selected.
// The light variant here is authored rather than borrowed: Lotus is the light
// counterpart to regular Kanagawa, and reusing it would have made the two
// themes identical in light mode. Dragon's own language is low chroma and warm
// neutrals, so its daylight is stone paper with dried-ink text, carrying the
// same hues at the lightness a light background needs.
//
// The dark side keeps every upstream value; it already cleared the floors once
// the guard could see it. What it gains is an explicit terminal background, a
// border that is not an 8% alpha wash, and the shape and emphasis tokens the
// palette-only version never set.
export const kanagawaDragon: Theme = {
  id: "kanagawa-dragon",
  name: "Kanagawa Dragon",
  description: "The muted, near-black Dragon variant of Kanagawa.",
  variants: {
    dark: {
      colors: {
        background: "#181616",
        foreground: "#c5c9c5",
        card: "#0d0c0c",
        cardForeground: "#c5c9c5",
        popover: "#0d0c0c",
        popoverForeground: "#c5c9c5",
        primary: "#8ba4b0",
        primaryForeground: "#181616",
        secondary: "#282727",
        secondaryForeground: "#c5c9c5",
        muted: "#282727",
        mutedForeground: "#a6a69c",
        accent: "#393836",
        accentForeground: "#c5c9c5",
        destructive: "#c4746e",
        border: "#3a3937",
        input: "#4d4b48",
        ring: "#8ba4b0",
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
        bevelOuter: "#282727",
        bevelMid: "transparent",
        bevelInner: "transparent",
      },
      terminal: {
        background: "#181616",
        foreground: "#c5c9c5",
        cursor: "#c5c9c5",
        cursorAccent: "#181616",
        selection: "rgba(45,79,103,0.45)",
        ansi: [
          "#0d0c0c", "#c4746e", "#8a9a7b", "#c4b28a",
          "#8ba4b0", "#a292a3", "#8ea4a2", "#c8c093",
          "#a6a69c", "#e46876", "#87a987", "#e6c384",
          "#7fb4ca", "#938aa9", "#7aa89f", "#c5c9c5",
        ],
      },
    },
    light: {
      colors: {
        background: "#e6e2da",
        foreground: "#383630",
        card: "#ddd8ce",
        cardForeground: "#383630",
        popover: "#efece5",
        popoverForeground: "#383630",
        primary: "#4a6570",
        primaryForeground: "#efece5",
        secondary: "#ddd8ce",
        secondaryForeground: "#383630",
        muted: "#ddd8ce",
        mutedForeground: "#5f5c53",
        accent: "#d2ccc0",
        accentForeground: "#383630",
        destructive: "#9d4f49",
        border: "#b4ada0",
        input: "#a29a8c",
        ring: "#4a6570",
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
        bevelOuter: "#efece5",
        bevelMid: "transparent",
        bevelInner: "transparent",
      },
      terminal: {
        background: "#ebe8e1",
        foreground: "#383630",
        cursor: "#4a6570",
        cursorAccent: "#ebe8e1",
        selection: "rgba(74,101,112,0.22)",
        ansi: [
          "#2b2926", "#9d4f49", "#5a6b4b", "#78643f",
          "#4a6570", "#6b5f6c", "#4e6663", "#55524a",
          "#7d7a71", "#b06a63", "#6f8060", "#957f57",
          "#5e7c88", "#837585", "#63807c", "#383630",
        ],
      },
    },
  },
};
