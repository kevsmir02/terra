# Nothing Theme Design Specification

**Date:** 2026-07-27  
**Status:** Approved  
**Topic:** Nothing OS-inspired Theme for Terra IDE

## Summary

This specification defines the "Nothing" built-in theme for Terra IDE. Inspired by Nothing OS design aesthetics, the theme combines a minimalist monochrome palette (`#0a0a0a` dark / `#f4f4f0` light) with signature crimson red (`#c23b2e`) accents, crisp 1px borders, 6px rounded widget corners (`0.375rem`), and authentic dot-matrix display typography (`DotGothic16`) for headers and chrome labels.

---

## 1. Font Integration

### Package Dependency
- **Package:** `@fontsource/dotgothic16` added to `dependencies` in `package.json`.

### Font Registry (`src/modules/theme/fonts.ts`)
- Add `"dotgothic16"` to `FONT_IDS`.
- Add loader in `LOADERS`:
  ```ts
  "dotgothic16": () => import("@fontsource/dotgothic16"),
  ```

---

## 2. Theme Definition (`src/modules/theme/themes/nothing.ts`)

```ts
import type { Theme } from "../types";

export const nothing: Theme = {
  id: "nothing",
  name: "Nothing",
  description: "Nothing OS-inspired theme with monochrome surfaces, dot-matrix typography, and red accents.",
  editorTheme: {
    light: "github-light",
    dark: "kanagawa",
  },
  variants: {
    dark: {
      colors: {
        background: "#0a0a0a",
        foreground: "#f0efe9",
        card: "#141412",
        cardForeground: "#f0efe9",
        popover: "#141412",
        popoverForeground: "#f0efe9",
        primary: "#c23b2e",
        primaryForeground: "#ffffff",
        secondary: "#1e1e1b",
        secondaryForeground: "#e0e0da",
        muted: "#232320",
        mutedForeground: "#8c8c86",
        accent: "#1a1a17",
        accentForeground: "#f0efe9",
        destructive: "#c23b2e",
        border: "#232320",
        input: "#232320",
        ring: "#c23b2e",
        radius: "0.375rem",
        sidebar: "#0a0a0a",
        sidebarForeground: "#f0efe9",
        sidebarPrimary: "#c23b2e",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#1a1a17",
        sidebarAccentForeground: "#f0efe9",
        sidebarBorder: "#232320",
        sidebarRing: "#c23b2e",
      },
      terminal: {
        background: "#0a0a0a",
        foreground: "#f0efe9",
        cursor: "#c23b2e",
        cursorAccent: "#0a0a0a",
        selection: "rgba(194, 59, 46, 0.3)",
        ansi: [
          "#1e1e1b", // 0: black
          "#c23b2e", // 1: red
          "#6a9c8a", // 2: green
          "#e0b84a", // 3: yellow
          "#5a8fc2", // 4: blue
          "#a878b0", // 5: magenta
          "#6a9c9c", // 6: cyan
          "#c8c8c2", // 7: white
          "#8c8c86", // 8: brightBlack (>3:1 contrast)
          "#d94b3d", // 9: brightRed
          "#7dae9b", // 10: brightGreen
          "#ebd06a", // 11: brightYellow
          "#6ca2d4", // 12: brightBlue
          "#b98bc1", // 13: brightMagenta
          "#7daeae", // 14: brightCyan
          "#f0efe9", // 15: brightWhite
        ],
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "8px",
        chromeWidth: "1px",
        panelWidth: "1px",
      },
      type: {
        sans: "'Inter Variable', -apple-system, sans-serif",
        display: "'DotGothic16', monospace",
        chromeTracking: "0.05em",
        chromeTransform: "uppercase",
        fonts: ["dotgothic16"],
      },
    },
    light: {
      colors: {
        background: "#f4f4f0",
        foreground: "#141412",
        card: "#e8e8e2",
        cardForeground: "#141412",
        popover: "#e8e8e2",
        popoverForeground: "#141412",
        primary: "#c23b2e",
        primaryForeground: "#ffffff",
        secondary: "#d8d8d2",
        secondaryForeground: "#141412",
        muted: "#e0e0da",
        mutedForeground: "#6c6c66",
        accent: "#deded8",
        accentForeground: "#141412",
        destructive: "#c23b2e",
        border: "#d4d4cd",
        input: "#d4d4cd",
        ring: "#c23b2e",
        radius: "0.375rem",
        sidebar: "#f4f4f0",
        sidebarForeground: "#141412",
        sidebarPrimary: "#c23b2e",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#deded8",
        sidebarAccentForeground: "#141412",
        sidebarBorder: "#d4d4cd",
        sidebarRing: "#c23b2e",
      },
      terminal: {
        background: "#f4f4f0",
        foreground: "#141412",
        cursor: "#c23b2e",
        cursorAccent: "#ffffff",
        selection: "rgba(194, 59, 46, 0.2)",
        ansi: [
          "#e8e8e2", // 0: black (background-adjacent)
          "#c23b2e", // 1: red
          "#2e7d5b", // 2: green
          "#b8860b", // 3: yellow
          "#2b6cb0", // 4: blue
          "#805ad5", // 5: magenta
          "#2c7a7b", // 6: cyan
          "#2d3748", // 7: white
          "#6c6c66", // 8: brightBlack (>3:1 contrast)
          "#a82e23", // 9: brightRed
          "#236347", // 10: brightGreen
          "#966d09", // 11: brightYellow
          "#22548a", // 12: brightBlue
          "#6b46c1", // 13: brightMagenta
          "#236162", // 14: brightCyan
          "#141412", // 15: brightWhite
        ],
      },
      shape: {
        frameWidth: "1px",
        frameRadius: "8px",
        chromeWidth: "1px",
        panelWidth: "1px",
      },
      type: {
        sans: "'Inter Variable', -apple-system, sans-serif",
        display: "'DotGothic16', monospace",
        chromeTracking: "0.05em",
        chromeTransform: "uppercase",
        fonts: ["dotgothic16"],
      },
    },
  },
};
```

---

## 3. Registration (`src/modules/theme/themes/index.ts`)

- Export `nothing` from `nothing.ts`.
- Register `nothing` in the `BUILTIN` array.

---

## 4. Verification Strategy

- Run `pnpm check-types`
- Run `pnpm test` (includes `builtins.test.ts` and `terminalLegibility.test.ts` to ensure contrast & ANSI rules are fully satisfied)
- Run `pnpm lint`
