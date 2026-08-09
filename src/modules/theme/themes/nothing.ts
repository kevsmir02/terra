import type { Theme } from "../types";

// Nothing OS: pure monochrome, dot-matrix type, one precise red.
//
// The previous pass described that identity but never showed it. DotGothic16
// was assigned to `display`, and Terra's chrome renders `sans`, so the
// signature face appeared nowhere. `borderStyle: "dotted"` was set, which is
// the right idea, but the border sat at #232320 on #0a0a0a where the texture
// was invisible. `sidebar` was byte-identical to `background` in both
// variants, so there was no surface hierarchy at all. And `primary` was red
// but nothing prominent used it, so the accent that should carry the whole
// theme never appeared on screen.
//
// This pass spends the identity instead of declaring it:
//
// - DotGothic16 moves to `sans`, so tabs, sidebar, statusbar and labels all
//   wear the dot-matrix face. That is what makes Nothing recognisable.
// - Borders lift far enough to read, because a dotted rule only works when you
//   can see the dots. `emphasis` is raised to match, so the texture is
//   deliberate rather than a smudge.
// - Surfaces get a real ladder: sidebar is the void, canvas one step up, cards
//   and popovers above that.
// - Greys go neutral. The old ones were slightly warm (#f0efe9, #8c8c86),
//   which muted the red instead of letting it snap.
// - Red is rationed: ring, cursor, primary. It is a signal, not a decoration.
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
        background: "#0b0b0b",
        foreground: "#f2f2f2",
        card: "#151515",
        cardForeground: "#f2f2f2",
        popover: "#1c1c1c",
        popoverForeground: "#f2f2f2",
        primary: "#d63b2e",
        primaryForeground: "#ffffff",
        secondary: "#1a1a1a",
        secondaryForeground: "#e6e6e6",
        muted: "#141414",
        mutedForeground: "#8a8a8a",
        accent: "#181818",
        accentForeground: "#f2f2f2",
        destructive: "#d63b2e",
        border: "#3a3a3a",
        input: "#3a3a3a",
        ring: "#d63b2e",
        radius: "0.25rem",
        borderStyle: "dotted",
        sidebar: "#000000",
        sidebarForeground: "#f2f2f2",
        sidebarPrimary: "#d63b2e",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#181818",
        sidebarAccentForeground: "#f2f2f2",
        sidebarBorder: "#3a3a3a",
        sidebarRing: "#d63b2e",
      },
      // Only a nudge above the defaults. Raising it further was tried and
      // reverted: `border-style: dotted` lands on the surface classes, not on
      // the panel dividers, so a heavy ladder makes every blend more opaque
      // without buying any of the texture this theme wants. Restraint is the
      // point of the design, so border contrast carries the dots instead.
      emphasis: {
        faint: "12%",
        subtle: "32%",
        soft: "45%",
        medium: "55%",
        strong: "68%",
        bold: "88%",
      },
      terminal: {
        background: "#0b0b0b",
        foreground: "#f2f2f2",
        cursor: "#d63b2e",
        cursorAccent: "#0b0b0b",
        selection: "rgba(214, 59, 46, 0.32)",
        ansi: [
          "#2a2a2a",
          "#d63b2e",
          "#6a9c8a",
          "#e0b84a",
          "#5a8fc2",
          "#a878b0",
          "#6a9c9c",
          "#c6c6c6",
          "#8a8a8a",
          "#e84c3d",
          "#7dae9b",
          "#ebd06a",
          "#6ca2d4",
          "#b98bc1",
          "#7daeae",
          "#f2f2f2",
        ],
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "10px",
        chromeWidth: "1px",
        panelWidth: "1px",
      },
      type: {
        sans: "'DotGothic16', 'Inter Variable', sans-serif",
        display: "'DotGothic16', monospace",
        chromeTracking: "0.02em",
        chromeTransform: "none",
        fonts: ["dotgothic16"],
      },
    },
    light: {
      colors: {
        background: "#f7f7f7",
        foreground: "#111111",
        card: "#ffffff",
        cardForeground: "#111111",
        popover: "#ffffff",
        popoverForeground: "#111111",
        primary: "#c8342a",
        primaryForeground: "#ffffff",
        secondary: "#ececec",
        secondaryForeground: "#111111",
        muted: "#eeeeee",
        mutedForeground: "#666666",
        accent: "#e8e8e8",
        accentForeground: "#111111",
        destructive: "#c8342a",
        border: "#b8b8b8",
        input: "#b8b8b8",
        ring: "#c8342a",
        radius: "0.25rem",
        borderStyle: "dotted",
        sidebar: "#eaeaea",
        sidebarForeground: "#111111",
        sidebarPrimary: "#c8342a",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#e0e0e0",
        sidebarAccentForeground: "#111111",
        sidebarBorder: "#b8b8b8",
        sidebarRing: "#c8342a",
      },
      // Only a nudge above the defaults. Raising it further was tried and
      // reverted: `border-style: dotted` lands on the surface classes, not on
      // the panel dividers, so a heavy ladder makes every blend more opaque
      // without buying any of the texture this theme wants. Restraint is the
      // point of the design, so border contrast carries the dots instead.
      emphasis: {
        faint: "12%",
        subtle: "32%",
        soft: "45%",
        medium: "55%",
        strong: "68%",
        bold: "88%",
      },
      terminal: {
        background: "#f7f7f7",
        foreground: "#111111",
        cursor: "#c8342a",
        cursorAccent: "#f7f7f7",
        selection: "rgba(200, 52, 42, 0.22)",
        ansi: [
          "#e0e0e0",
          "#c8342a",
          "#2e7d5b",
          "#b8860b",
          "#2b6cb0",
          "#805ad5",
          "#2c7a7b",
          "#3a3a3a",
          "#666666",
          "#a82e23",
          "#236347",
          "#966d09",
          "#22548a",
          "#6b46c1",
          "#236162",
          "#111111",
        ],
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "10px",
        chromeWidth: "1px",
        panelWidth: "1px",
      },
      type: {
        sans: "'DotGothic16', 'Inter Variable', sans-serif",
        display: "'DotGothic16', monospace",
        chromeTracking: "0.02em",
        chromeTransform: "none",
        fonts: ["dotgothic16"],
      },
    },
  },
};
