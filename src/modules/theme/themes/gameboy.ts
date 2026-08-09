import type { Theme } from "../types";

// Game Boy: DMG chassis, Game Boy Color screen.
//
// The shell is the 1989 handheld. Square corners all the way out, chunky 2px
// outlines, a hard unblurred drop shadow, and the four DMG greens
// (#0f380f, #306230, #8bac0f, #9bbc0f) carrying the surfaces. Light mode is the
// LCD in daylight, dark mode is the same panel lit from behind.
//
// The code surface is Game Boy Color rather than DMG, and that is a deliberate
// split. Terra derives eighteen syntax roles from the sixteen ANSI slots, so a
// faithful four-tone DMG palette would collapse every role into a different
// lightness of the same green: legible, because the contrast floors guarantee
// it, but no longer colour-coded. The chassis is the console; the screen is
// where you actually work.
//
// Type is Pixelify Sans, shared with stardew. Press Start 2P is the more iconic
// arcade face and is deliberately not used: it is an 8x8 bitmap with a
// cap-height of 1.000em against Inter's 0.727em, so at Terra's 9px-13px chrome
// it would render enormous and land on fractional pixels, the same shimmer that
// made DotGothic16 tiring in the nothing theme.
//
// `emphasis` runs high. A pixel-art UI wants its outlines to read as drawn
// strokes rather than hairlines, which is exactly what the ladder is for.
export const gameboy: Theme = {
  id: "gameboy",
  name: "Game Boy",
  description: "DMG chassis, Game Boy Color screen. Pea-green LCD and pixel type.",
  editorTheme: { light: "github-light", dark: "gruvbox-dark" },
  variants: {
    light: {
      colors: {
        background: "#c4d17a",
        foreground: "#0f380f",
        card: "#b5c46a",
        cardForeground: "#0f380f",
        popover: "#d2dc92",
        popoverForeground: "#0f380f",
        primary: "#306230",
        primaryForeground: "#d2dc92",
        secondary: "#b5c46a",
        secondaryForeground: "#0f380f",
        muted: "#b5c46a",
        mutedForeground: "#33541f",
        accent: "#9bbc0f",
        accentForeground: "#0f380f",
        destructive: "#8b2c2c",
        border: "#33541f",
        input: "#33541f",
        ring: "#306230",
        radius: "0rem",
        borderStyle: "solid",
        sidebar: "#a8b85e",
        sidebarForeground: "#0f380f",
        sidebarPrimary: "#306230",
        sidebarPrimaryForeground: "#d2dc92",
        sidebarAccent: "#9bbc0f",
        sidebarAccentForeground: "#0f380f",
        sidebarBorder: "#33541f",
        sidebarRing: "#306230",
      },
      emphasis: {
        faint: "15%",
        subtle: "40%",
        soft: "55%",
        medium: "70%",
        strong: "85%",
        bold: "100%",
      },
      shape: {
        frameWidth: "3px",
        frameRadius: "0px",
        framePadding: "0px",
        chromeWidth: "2px",
        panelWidth: "2px",
        slotWidth: "2px",
        controlWidth: "2px",
        bevelWidth: "1px",
        bevelOuter: "#d2dc92",
        bevelMid: "transparent",
        bevelInner: "transparent",
        liftColor: "#33541f",
        liftDepth: "2px",
      },
      type: {
        sans: "'Pixelify Sans', 'Inter Variable', sans-serif",
        display: "'Pixelify Sans', 'Inter Variable', sans-serif",
        chromeTracking: "0.01em",
        chromeTransform: "none",
        fonts: ["pixelify-sans"],
      },
      terminal: {
        background: "#c4d17a",
        foreground: "#0f380f",
        cursor: "#306230",
        cursorAccent: "#c4d17a",
        selection: "rgba(48,98,48,0.30)",
        ansi: [
          "#0f380f", "#7a2020", "#2f5d18", "#6b4a05",
          "#1e4a6b", "#5f2d55", "#145450", "#40561f",
          "#33541f", "#5e1717", "#244a12", "#523904",
          "#173a52", "#4a2342", "#0f423f", "#0a2b0a",
        ],
      },
    },
    dark: {
      colors: {
        background: "#0f2410",
        foreground: "#b8d143",
        card: "#16311a",
        cardForeground: "#b8d143",
        popover: "#1c3d21",
        popoverForeground: "#b8d143",
        primary: "#9bbc0f",
        primaryForeground: "#0f2410",
        secondary: "#16311a",
        secondaryForeground: "#b8d143",
        muted: "#16311a",
        mutedForeground: "#83a049",
        accent: "#1c3d21",
        accentForeground: "#b8d143",
        destructive: "#c4553d",
        border: "#3d6b3d",
        input: "#3d6b3d",
        ring: "#9bbc0f",
        radius: "0rem",
        borderStyle: "solid",
        sidebar: "#0a1a0b",
        sidebarForeground: "#b8d143",
        sidebarPrimary: "#9bbc0f",
        sidebarPrimaryForeground: "#0f2410",
        sidebarAccent: "#1c3d21",
        sidebarAccentForeground: "#b8d143",
        sidebarBorder: "#3d6b3d",
        sidebarRing: "#9bbc0f",
      },
      emphasis: {
        faint: "15%",
        subtle: "40%",
        soft: "55%",
        medium: "70%",
        strong: "85%",
        bold: "100%",
      },
      shape: {
        frameWidth: "3px",
        frameRadius: "0px",
        framePadding: "0px",
        chromeWidth: "2px",
        panelWidth: "2px",
        slotWidth: "2px",
        controlWidth: "2px",
        bevelWidth: "1px",
        bevelOuter: "#3d6b3d",
        bevelMid: "transparent",
        bevelInner: "transparent",
        liftColor: "#050d05",
        liftDepth: "2px",
      },
      type: {
        sans: "'Pixelify Sans', 'Inter Variable', sans-serif",
        display: "'Pixelify Sans', 'Inter Variable', sans-serif",
        chromeTracking: "0.01em",
        chromeTransform: "none",
        fonts: ["pixelify-sans"],
      },
      terminal: {
        background: "#0f2410",
        foreground: "#b8d143",
        cursor: "#9bbc0f",
        cursorAccent: "#0f2410",
        selection: "rgba(155,188,15,0.28)",
        ansi: [
          "#2a4a2a", "#e0705c", "#9bbc0f", "#e0b641",
          "#6aa8d4", "#c08ab8", "#5fc4b8", "#b8d143",
          "#5a7a4a", "#f08a76", "#b8d94a", "#f0cf68",
          "#8ac4e8", "#d8a8d0", "#84dcd0", "#dcecb0",
        ],
      },
    },
  },
};
