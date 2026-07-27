# Nothing Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new built-in theme to Terra called "Nothing", inspired by Nothing OS design aesthetics with monochrome surfaces, red accents, and dot-matrix display typography (`DotGothic16`).

**Architecture:** Add `@fontsource/dotgothic16` to font dependencies and register it in `src/modules/theme/fonts.ts`. Define the `nothing` theme object with light and dark variants in `src/modules/theme/themes/nothing.ts` and register it in `src/modules/theme/themes/index.ts`. Verify against built-in theme structure and terminal legibility test suites.

**Tech Stack:** React, TypeScript, Vitest, `@fontsource/dotgothic16`.

## Global Constraints
- Theme must set CSS variables only, no CSS selectors or custom stylesheets.
- Both `light` and `dark` variants must be defined.
- `editorTheme` must point to same-mode editor themes (`light: "github-light"`, `dark: "kanagawa"`).
- Terminal palette must satisfy `terminalLegibility.test.ts` rules:
  - No slot equals background.
  - Blue differs from cyan.
  - Normal slots 1-7 clear 4.5:1 contrast against background.
  - Bright slots 9-15 and slot 8 (`brightBlack`) clear 3:1 contrast against background.
  - Terminal background saturation under 25%.

---

### Task 1: Add Font Dependency and Register `dotgothic16`

**Files:**
- Modify: `package.json`
- Modify: `src/modules/theme/fonts.ts`

**Interfaces:**
- Consumes: `@fontsource/dotgothic16` package
- Produces: `"dotgothic16"` font ID in `FONT_IDS` and loader in `LOADERS`

- [ ] **Step 1: Install `@fontsource/dotgothic16` package**

Run: `pnpm add @fontsource/dotgothic16`
Expected: Package added to `package.json` dependencies.

- [ ] **Step 2: Update font registry in `src/modules/theme/fonts.ts`**

Update `src/modules/theme/fonts.ts` to include `"dotgothic16"` in `FONT_IDS` and add the loader to `LOADERS`:

```ts
export const FONT_IDS = [
  "dotgothic16",
  "pixelify-sans",
  "press-start-2p",
  "vt323",
] as const;

export type FontId = (typeof FONT_IDS)[number];

export function isFontId(v: unknown): v is FontId {
  return typeof v === "string" && (FONT_IDS as readonly string[]).includes(v);
}

const loaded = new Set<FontId>();

const LOADERS: Record<FontId, () => Promise<unknown>> = {
  dotgothic16: () => import("@fontsource/dotgothic16"),
  "pixelify-sans": () => import("@/styles/pixelify-sans.css"),
  "press-start-2p": () => import("@fontsource/press-start-2p"),
  vt323: () => import("@fontsource/vt323"),
};
```

- [ ] **Step 3: Run type check**

Run: `pnpm check-types`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit font registration**

```bash
git add package.json pnpm-lock.yaml src/modules/theme/fonts.ts
git commit -m "feat(theme): add dotgothic16 font dependency and loader"
```

---

### Task 2: Create `nothing` Theme Definition and Register in Builtins

**Files:**
- Create: `src/modules/theme/themes/nothing.ts`
- Modify: `src/modules/theme/themes/index.ts`

**Interfaces:**
- Consumes: `Theme` type from `src/modules/theme/types.ts`
- Produces: `nothing` theme export and `BUILTIN` registration

- [ ] **Step 1: Create `src/modules/theme/themes/nothing.ts`**

Write the complete `nothing` theme definition:

```ts
import type { Theme } from "../types";

export const nothing: Theme = {
  id: "nothing",
  name: "Nothing",
  description:
    "Nothing OS-inspired theme with monochrome surfaces, dot-matrix typography, and red accents.",
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
          "#1e1e1b",
          "#c23b2e",
          "#6a9c8a",
          "#e0b84a",
          "#5a8fc2",
          "#a878b0",
          "#6a9c9c",
          "#c8c8c2",
          "#8c8c86",
          "#d94b3d",
          "#7dae9b",
          "#ebd06a",
          "#6ca2d4",
          "#b98bc1",
          "#7daeae",
          "#f0efe9",
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
          "#e8e8e2",
          "#c23b2e",
          "#2e7d5b",
          "#b8860b",
          "#2b6cb0",
          "#805ad5",
          "#2c7a7b",
          "#2d3748",
          "#6c6c66",
          "#a82e23",
          "#236347",
          "#966d09",
          "#22548a",
          "#6b46c1",
          "#236162",
          "#141412",
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

- [ ] **Step 2: Register theme in `src/modules/theme/themes/index.ts`**

Export `nothing` and include it in `BUILTIN` array in `src/modules/theme/themes/index.ts`:

```ts
import type { Theme } from "../types";
import { caffeine } from "./caffeine";
import { everforest } from "./everforest";
import { gruvbox } from "./gruvbox";
import { kanagawa } from "./kanagawa";
import { kanagawaDragon } from "./kanagawa-dragon";
import { nord } from "./nord";
import { nothing } from "./nothing";
import { sage } from "./sage";
import { stardew } from "./stardew";
import { terraDefault } from "./terra-default";
import { tide } from "./tide";
import { tokyoNight } from "./tokyo-night";

export {
  terraDefault,
  stardew,
  kanagawa,
  kanagawaDragon,
  everforest,
  gruvbox,
  tokyoNight,
  nord,
  caffeine,
  sage,
  tide,
  nothing,
};

export const BUILTIN: readonly Theme[] = [
  terraDefault,
  nothing,
  stardew,
  kanagawa,
  kanagawaDragon,
  everforest,
  gruvbox,
  tokyoNight,
  nord,
  caffeine,
  sage,
  tide,
];
```

- [ ] **Step 3: Run Vitest tests**

Run: `pnpm test`
Expected: PASS for all tests including `builtins.test.ts` and `terminalLegibility.test.ts`.

- [ ] **Step 4: Commit Nothing theme implementation**

```bash
git add src/modules/theme/themes/nothing.ts src/modules/theme/themes/index.ts
git commit -m "feat(theme): add Nothing built-in theme"
```

---

### Task 3: Full Verification Suite

**Files:**
- Test all theme tests, linting, and type check across repository.

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: PASS with 0 failures.

- [ ] **Step 2: Run type check**

Run: `pnpm check-types`
Expected: PASS with 0 errors.

- [ ] **Step 3: Run linter**

Run: `pnpm lint`
Expected: PASS with 0 lint errors.
