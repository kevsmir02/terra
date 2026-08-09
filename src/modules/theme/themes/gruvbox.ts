import type { Theme } from "../types";

// Gruvbox: warm, earthy, retro. Chunky edges rather than soft ones.
//
// Both variants shipped with ANSI slot 0 set to the exact value of the
// background, which is the invisible-text bug THEME.md bans outright: anything
// printing SGR 30 vanished. That is the canonical upstream mapping in light
// mode, and it loses here, because a colour you cannot see is not a colour.
//
// The fix that does most of the work is declaring a terminal background from
// gruvbox's own hard ramp: dark0_hard #1d2021 (the 6%-saturation exemplar
// THEME.md cites) and light0_hard #f9f5d7. Slot 0 is then distinct from the
// background by construction rather than by correction, and the rest of the
// palette gains headroom.
//
// neutral_red at 3.00:1 could not be nudged, so normal red takes upstream's own
// bright_red #fb4934 and the bright slot is lifted above it. Gruvbox only
// defines two reds; a third level has to come from somewhere once both need to
// clear a floor and stay distinguishable from each other.
//
// Shape follows the character: square-ish corners, a 2px frame, and borders
// drawn as opaque values from the bg ramp instead of an alpha wash.
export const gruvbox: Theme = {
  id: "gruvbox",
  name: "Gruvbox",
  description: "Warm, earthy retro palette.",
  editorTheme: { dark: "gruvbox-dark", light: "github-light" },
  variants: {
    dark: {
      colors: {
        background: "#282828",
        foreground: "#ebdbb2",
        card: "#32302f",
        cardForeground: "#ebdbb2",
        popover: "#32302f",
        popoverForeground: "#ebdbb2",
        primary: "#fabd2f",
        primaryForeground: "#282828",
        secondary: "#3c3836",
        secondaryForeground: "#ebdbb2",
        muted: "#3c3836",
        mutedForeground: "#a89984",
        accent: "#3c3836",
        accentForeground: "#ebdbb2",
        destructive: "#fb4934",
        border: "#504945",
        input: "#665c54",
        ring: "#fabd2f",
        radius: "0.25rem",
        borderStyle: "solid",
        sidebar: "#1d2021",
        sidebarForeground: "#ebdbb2",
        sidebarPrimary: "#fabd2f",
        sidebarPrimaryForeground: "#282828",
        sidebarAccent: "#3c3836",
        sidebarAccentForeground: "#ebdbb2",
        sidebarBorder: "#504945",
        sidebarRing: "#fabd2f",
      },
      emphasis: {
        faint: "15%",
        subtle: "40%",
        soft: "50%",
        medium: "62%",
        strong: "75%",
        bold: "95%",
      },
      shape: {
        frameWidth: "2px",
        frameRadius: "8px",
        framePadding: "0px",
        chromeWidth: "1px",
        panelWidth: "1px",
        bevelWidth: "1px",
        bevelOuter: "#3c3836",
        bevelMid: "transparent",
        bevelInner: "transparent",
      },
      terminal: {
        background: "#1d2021",
        foreground: "#ebdbb2",
        cursor: "#ebdbb2",
        cursorAccent: "#1d2021",
        selection: "rgba(250,189,47,0.25)",
        ansi: [
          "#282828", "#fb4934", "#98971a", "#d79921",
          "#529294", "#bf6f93", "#689d6a", "#a89984",
          "#928374", "#ff5f48", "#b8bb26", "#fabd2f",
          "#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
        ],
      },
    },
    light: {
      colors: {
        background: "#fbf1c7",
        foreground: "#3c3836",
        card: "#f9f5d7",
        cardForeground: "#3c3836",
        popover: "#f9f5d7",
        popoverForeground: "#3c3836",
        primary: "#b57614",
        primaryForeground: "#fbf1c7",
        secondary: "#ebdbb2",
        secondaryForeground: "#3c3836",
        muted: "#ebdbb2",
        mutedForeground: "#776a60",
        accent: "#ebdbb2",
        accentForeground: "#3c3836",
        destructive: "#9d0006",
        border: "#bdae93",
        input: "#a89984",
        ring: "#b57614",
        radius: "0.25rem",
        borderStyle: "solid",
        sidebar: "#f2e5bc",
        sidebarForeground: "#3c3836",
        sidebarPrimary: "#b57614",
        sidebarPrimaryForeground: "#fbf1c7",
        sidebarAccent: "#ebdbb2",
        sidebarAccentForeground: "#3c3836",
        sidebarBorder: "#bdae93",
        sidebarRing: "#b57614",
      },
      emphasis: {
        faint: "15%",
        subtle: "40%",
        soft: "50%",
        medium: "62%",
        strong: "75%",
        bold: "95%",
      },
      shape: {
        frameWidth: "2px",
        frameRadius: "8px",
        framePadding: "0px",
        chromeWidth: "1px",
        panelWidth: "1px",
        bevelWidth: "1px",
        bevelOuter: "#f9f5d7",
        bevelMid: "transparent",
        bevelInner: "transparent",
      },
      terminal: {
        background: "#f9f5d7",
        foreground: "#3c3836",
        cursor: "#3c3836",
        cursorAccent: "#f9f5d7",
        selection: "rgba(181,118,20,0.22)",
        ansi: [
          "#282828", "#9d0006", "#767108", "#9e6000",
          "#076678", "#8f3f71", "#407957", "#796c62",
          "#928374", "#cc241d", "#918f08", "#bb7f00",
          "#458588", "#b16286", "#639765", "#3c3836",
        ],
      },
    },
  },
};
