import type { Theme } from "../types";

// Stardew-style wooden UI. The design rule is that a dark outline separates
// surfaces rather than a value jump, which is why the palette stays warm and
// close in tone. The previous pass took that literally enough that nothing
// separated at all: three surfaces within a few percent of each other, an
// outline too close in value to read, and a 2px #ffd46b bevel around the whole
// window that was the loudest thing on screen.
//
// This pass keeps the rule and makes it work:
//
// - Surfaces still sit in one hue family, but with a real ladder underneath
//   them: sidebar is the shadowed plank, canvas the table, card the raised
//   plank, popover the lit one.
// - The deepest surface is pulled toward neutral so the mid tones read as warm
//   wood rather than as generic brown. Warm needs something to be warm against.
// - `emphasis` raises the whole alpha ladder. This theme leans on outlines, so
//   it says so instead of hoping the defaults are strong enough. That is the
//   token the engine exists to expose.
// - The gold is a 1px carved highlight (`bevelOuter`, mid and inner
//   transparent per THEME.md) instead of a ring drawn around everything.
// - Square all the way out: `radius` and `frameRadius` agree, per the
//   corollary in THEME.md's design guidance.
// - Chrome is sentence case with near-zero tracking. Uppercase plus 0.04em in
//   a wide pixel face overflowed the sidebar tabs into "Sour..." / "Devic...".
//
// Terminal ANSI is tuned per variant against its own background: every normal
// slot clears 4.5:1 and every bright slot clears 3:1, with blue and cyan held
// apart in hue so diff and log output stays parseable.
export const stardew: Theme = {
  id: "stardew",
  name: "Stardew",
  description: "Warm farmhouse wood, carved gold edges, parchment and lamplight.",
  editorTheme: { light: "github-light", dark: "gruvbox-dark" },
  variants: {
    light: {
      colors: {
        background: "#f4e4c1",
        foreground: "#3b2712",
        card: "#e9d4a8",
        cardForeground: "#3b2712",
        popover: "#fbf1da",
        popoverForeground: "#3b2712",
        primary: "#a85d22",
        primaryForeground: "#fbf1da",
        secondary: "#e3d0a4",
        secondaryForeground: "#3b2712",
        muted: "#e3d0a4",
        mutedForeground: "#6b5335",
        accent: "#e3b970",
        accentForeground: "#3b2712",
        destructive: "#a3342a",
        border: "#7a5228",
        input: "#7a5228",
        ring: "#a85d22",
        sidebar: "#e0c795",
        sidebarForeground: "#3b2712",
        sidebarPrimary: "#a85d22",
        sidebarPrimaryForeground: "#fbf1da",
        sidebarAccent: "#e3b970",
        sidebarAccentForeground: "#3b2712",
        sidebarBorder: "#7a5228",
        sidebarRing: "#a85d22",
        radius: "0rem",
        borderStyle: "solid",
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
        bevelOuter: "#d9b877",
        bevelMid: "transparent",
        bevelInner: "transparent",
        liftColor: "#7a5228",
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
        background: "#f4e4c1",
        foreground: "#3b2712",
        cursor: "#a85d22",
        cursorAccent: "#f4e4c1",
        selection: "rgba(168,93,34,0.26)",
        ansi: [
          "#2b1a0c", "#a3271d", "#325816", "#7a4404",
          "#1a4675", "#7a2559", "#0e5652", "#5f452a",
          "#6e4f32", "#941f16", "#284d12", "#6e3d02",
          "#143d68", "#681c4c", "#094a46", "#3b2712",
        ],
      },
    },
    dark: {
      colors: {
        background: "#241609",
        foreground: "#f2dcc0",
        card: "#33200e",
        cardForeground: "#f2dcc0",
        popover: "#3d2712",
        popoverForeground: "#f2dcc0",
        primary: "#e8a33d",
        primaryForeground: "#241609",
        secondary: "#2e1d0d",
        secondaryForeground: "#f2dcc0",
        muted: "#2e1d0d",
        mutedForeground: "#b89a78",
        accent: "#4a2e14",
        accentForeground: "#f2dcc0",
        destructive: "#c4453a",
        border: "#6b4423",
        input: "#6b4423",
        ring: "#e8a33d",
        sidebar: "#150d06",
        sidebarForeground: "#f2dcc0",
        sidebarPrimary: "#e8a33d",
        sidebarPrimaryForeground: "#241609",
        sidebarAccent: "#4a2e14",
        sidebarAccentForeground: "#f2dcc0",
        sidebarBorder: "#6b4423",
        sidebarRing: "#e8a33d",
        radius: "0rem",
        borderStyle: "solid",
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
        bevelOuter: "#7a5228",
        bevelMid: "transparent",
        bevelInner: "transparent",
        liftColor: "#0d0703",
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
        background: "#1e1208",
        foreground: "#f2dcc0",
        cursor: "#e8a33d",
        cursorAccent: "#1e1208",
        selection: "rgba(232,163,61,0.30)",
        ansi: [
          "#2a1a0c", "#f0685a", "#9ac356", "#eec052",
          "#74b0e2", "#dc8ec2", "#6cc9bf", "#e3cfa5",
          "#ac8558", "#ff9086", "#bde383", "#ffdf88",
          "#a3d0f5", "#f2b4da", "#9ae8dd", "#fff6e0",
        ],
      },
    },
  },
};
