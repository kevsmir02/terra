import type { Theme } from "../types";

// Windows XP: Luna Blue by day, Royale Noir by night, cmd.exe throughout.
//
// An homage in flat colour, not a skin. A Terra theme sets CSS variables and
// nothing else, and there is no gradient token, so the Luna title bar, the
// glossy Start button and the taskbar sheen are all out of reach. The bevel
// draws concentric inset rings rather than directional edges, so the carved
// 3D look is approximated rather than reproduced.
//
// The window frame is built from the three bevel rings on purpose. `frameWidth`
// is declared to match the other themes, but it currently renders nothing: the
// re-defined `border` utility is what reads --surface-border-width, and the
// frame element in App.tsx carries no border class. Stardew and gameboy have
// the same dead 3px. The ring sequence (dark outline, blue frame, beige inner)
// is what an XP window border actually steps through anyway.
//
// Surfaces are beige with blue accents rather than blue throughout, because
// `card` is the side-panel container as well as the header and statusbar, and
// a blue explorer would be far more Luna than Luna ever was.
//
// Dark mode is Royale Noir, the dark XP theme Microsoft built for Media Center
// and never shipped, rather than an invented Luna at night. Terra needs both
// variants: a single-variant theme silently serves the wrong palette across
// modes.
//
// The terminal does not change with the mode, because cmd.exe never followed
// the desktop theme. Its background is #0c0c0c rather than pure black so that
// slot 0 can be a true #000000 without becoming the background.
//
// The DOS 16 are seeds, not the shipped values. That palette's normal row is
// the famously unreadable one (#000080 on black is about 1.3:1), and even
// Microsoft's 2017 replacement does not clear 4.5:1 there, because terminal
// palettes have always aimed at roughly 3:1. Each slot is raised through
// ensureContrast, which moves OKLab lightness only, so the hues stay DOS while
// the numbers stop being hostile. Where a raised normal collided with its
// bright twin, the bright was lifted rather than the normal lowered.
export const windowsXp: Theme = {
  id: "windows-xp",
  name: "Windows XP",
  description: "Luna Blue and the beige control panel, with a cmd.exe console.",
  editorTheme: { light: "github-light", dark: "github-dark" },
  variants: {
    light: {
      colors: {
        background: "#ffffff",
        foreground: "#000000",
        card: "#ece9d8",
        cardForeground: "#000000",
        popover: "#ffffff",
        popoverForeground: "#000000",
        primary: "#245edc",
        primaryForeground: "#ffffff",
        secondary: "#d4d0c8",
        secondaryForeground: "#000000",
        muted: "#ece9d8",
        mutedForeground: "#5a5750",
        accent: "#316ac5",
        accentForeground: "#ffffff",
        destructive: "#a80000",
        border: "#aca899",
        input: "#7f9db9",
        ring: "#316ac5",
        radius: "0rem",
        borderStyle: "solid",
        sidebar: "#ece9d8",
        sidebarForeground: "#000000",
        sidebarPrimary: "#245edc",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#316ac5",
        sidebarAccentForeground: "#ffffff",
        sidebarBorder: "#aca899",
        sidebarRing: "#316ac5",
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
        chromeWidth: "1px",
        panelWidth: "1px",
        bevelWidth: "1px",
        bevelOuter: "#0a246a",
        bevelMid: "#245edc",
        bevelInner: "#ece9d8",
      },
      type: {
        sans: "Tahoma, Verdana, 'DejaVu Sans', 'Inter Variable', sans-serif",
        display: "Tahoma, Verdana, 'DejaVu Sans', 'Inter Variable', sans-serif",
        chromeTracking: "0em",
        chromeTransform: "none",
      },
      terminal: {
        background: "#0c0c0c",
        foreground: "#c0c0c0",
        cursor: "#c0c0c0",
        cursorAccent: "#0c0c0c",
        selection: "rgba(49,106,197,0.40)",
        fontFamily: "'Lucida Console', 'DejaVu Sans Mono', monospace",
        ansi: [
          "#000000", "#cc5546", "#1e8e1a", "#808000",
          "#4275eb", "#bd4dbb", "#178988", "#c0c0c0",
          "#808080", "#ff3e30", "#00ff00", "#ffff00",
          "#5088ff", "#ff00ff", "#00ffff", "#ffffff",
        ],
      },
    },
    dark: {
      colors: {
        background: "#1b1b1b",
        foreground: "#e8e8e8",
        card: "#2b2b2b",
        cardForeground: "#e8e8e8",
        popover: "#333333",
        popoverForeground: "#e8e8e8",
        primary: "#3c7fb1",
        primaryForeground: "#ffffff",
        secondary: "#3a3a3a",
        secondaryForeground: "#e8e8e8",
        muted: "#3a3a3a",
        mutedForeground: "#a0a0a0",
        accent: "#2e5a87",
        accentForeground: "#ffffff",
        destructive: "#c05050",
        border: "#4a4a4a",
        input: "#5a5a5a",
        ring: "#3c7fb1",
        radius: "0rem",
        borderStyle: "solid",
        sidebar: "#232323",
        sidebarForeground: "#e8e8e8",
        sidebarPrimary: "#3c7fb1",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#2e5a87",
        sidebarAccentForeground: "#ffffff",
        sidebarBorder: "#4a4a4a",
        sidebarRing: "#3c7fb1",
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
        chromeWidth: "1px",
        panelWidth: "1px",
        bevelWidth: "1px",
        bevelOuter: "#000000",
        bevelMid: "#3a3a3a",
        bevelInner: "#1b1b1b",
      },
      type: {
        sans: "Tahoma, Verdana, 'DejaVu Sans', 'Inter Variable', sans-serif",
        display: "Tahoma, Verdana, 'DejaVu Sans', 'Inter Variable', sans-serif",
        chromeTracking: "0em",
        chromeTransform: "none",
      },
      terminal: {
        background: "#0c0c0c",
        foreground: "#c0c0c0",
        cursor: "#c0c0c0",
        cursorAccent: "#0c0c0c",
        selection: "rgba(49,106,197,0.40)",
        fontFamily: "'Lucida Console', 'DejaVu Sans Mono', monospace",
        ansi: [
          "#000000", "#cc5546", "#1e8e1a", "#808000",
          "#4275eb", "#bd4dbb", "#178988", "#c0c0c0",
          "#808080", "#ff3e30", "#00ff00", "#ffff00",
          "#5088ff", "#ff00ff", "#00ffff", "#ffffff",
        ],
      },
    },
  },
};
