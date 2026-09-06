import type { Theme } from "../types";

// Brutalist: no radius, a 2px rule doing every separation, uppercase tracked
// chrome, one pink carrying every action.
//
// Two decisions here are load-bearing and look arbitrary from the outside:
//
// `emphasis.strong` and `.bold` are 100%. Terra draws chrome borders as
// `border-border/(--emph-strong)`, so at the stock 60% a black rule renders
// grey and the theme reads as an ordinary flat one. Full strength is what
// makes the rule a rule.
//
// The rule is 2px, not 3px or more. THEME.md caps chrome borders at roughly
// 2px because the header and statusbar are only 32px to 40px tall, and the
// hard offset shadow that would otherwise carry this style is unreachable:
// `liftColor`/`liftDepth` paint an outset shadow on `.terra-frame`, which
// `#root`'s `overflow: hidden` clips. Weight in the border is the substitute.
export const rebar: Theme = {
  id: "rebar",
  name: "Rebar",
  description: "Brutalist. Hard rule, no radius, one pink.",
  editorTheme: {
    light: "github-light",
    dark: "kanagawa",
  },
  variants: {
    dark: {
      colors: {
        background: "#161615",
        foreground: "#edeae0",
        card: "#1e1e1c",
        cardForeground: "#edeae0",
        popover: "#1e1e1c",
        popoverForeground: "#edeae0",
        primary: "#ff3d8b",
        primaryForeground: "#0b0b0b",
        secondary: "#2a2a27",
        secondaryForeground: "#edeae0",
        muted: "#2a2a27",
        mutedForeground: "#a5a196",
        accent: "#2e2e2a",
        accentForeground: "#edeae0",
        destructive: "#ff5a4d",
        // Bone rather than white: a 2px pure-white rule on every edge is
        // punishing in a window someone keeps open all day.
        border: "#b5b1a3",
        input: "#b5b1a3",
        ring: "#ff3d8b",
        radius: "0rem",
        borderStyle: "solid",
        sidebar: "#1e1e1c",
        sidebarForeground: "#edeae0",
        sidebarPrimary: "#ff3d8b",
        sidebarPrimaryForeground: "#0b0b0b",
        sidebarAccent: "#2e2e2a",
        sidebarAccentForeground: "#edeae0",
        sidebarBorder: "#b5b1a3",
        sidebarRing: "#ff3d8b",
      },
      emphasis: {
        faint: "14%",
        subtle: "40%",
        soft: "55%",
        medium: "70%",
        strong: "100%",
        bold: "100%",
      },
      terminal: {
        background: "#161615",
        foreground: "#edeae0",
        cursor: "#ff3d8b",
        cursorAccent: "#0b0b0b",
        selection: "rgba(255, 61, 139, 0.30)",
        ansi: [
          "#2a2a27",
          "#ff5a4d",
          "#7bc96f",
          "#f2c14e",
          "#6c9cf5",
          "#ff6fb0",
          "#5fc9c9",
          "#d6d2c4",
          "#8a867a",
          "#ff7a6e",
          "#96d98c",
          "#ffd470",
          "#8fb4f7",
          "#ff8fc4",
          "#7fdada",
          "#f5f3ec",
        ],
      },
      shape: {
        frameWidth: "2px",
        frameRadius: "0px",
        framePadding: "0px",
        chromeWidth: "2px",
        panelWidth: "2px",
        bevelWidth: "0px",
      },
      type: {
        chromeTracking: "0.08em",
        chromeTransform: "uppercase",
      },
    },
    light: {
      colors: {
        background: "#edeae0",
        foreground: "#0b0b0b",
        card: "#f7f5ef",
        cardForeground: "#0b0b0b",
        popover: "#f7f5ef",
        popoverForeground: "#0b0b0b",
        primary: "#ff3d8b",
        primaryForeground: "#0b0b0b",
        secondary: "#e0dccd",
        secondaryForeground: "#0b0b0b",
        muted: "#e0dccd",
        mutedForeground: "#5a574c",
        accent: "#dcd8c9",
        accentForeground: "#0b0b0b",
        destructive: "#c7261c",
        border: "#0b0b0b",
        input: "#0b0b0b",
        ring: "#ff3d8b",
        radius: "0rem",
        borderStyle: "solid",
        sidebar: "#f7f5ef",
        sidebarForeground: "#0b0b0b",
        sidebarPrimary: "#ff3d8b",
        sidebarPrimaryForeground: "#0b0b0b",
        sidebarAccent: "#dcd8c9",
        sidebarAccentForeground: "#0b0b0b",
        sidebarBorder: "#0b0b0b",
        sidebarRing: "#ff3d8b",
      },
      emphasis: {
        faint: "14%",
        subtle: "40%",
        soft: "55%",
        medium: "70%",
        strong: "100%",
        bold: "100%",
      },
      terminal: {
        background: "#edeae0",
        foreground: "#0b0b0b",
        cursor: "#ff3d8b",
        cursorAccent: "#0b0b0b",
        selection: "rgba(255, 61, 139, 0.22)",
        ansi: [
          "#0b0b0b",
          "#c7261c",
          "#2f6b23",
          "#8a5a00",
          "#1f4fd8",
          "#b01a6b",
          "#136b6b",
          "#3a382f",
          "#6b6759",
          "#e5352b",
          "#3f8a2e",
          "#a87200",
          "#2e5fe8",
          "#d62585",
          "#1a8a8a",
          "#141414",
        ],
      },
      shape: {
        frameWidth: "2px",
        frameRadius: "0px",
        framePadding: "0px",
        chromeWidth: "2px",
        panelWidth: "2px",
        bevelWidth: "0px",
      },
      type: {
        chromeTracking: "0.08em",
        chromeTransform: "uppercase",
      },
    },
  },
};
