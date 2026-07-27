# Themable Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a theme control border weight, bevels, density, type scale and fonts through theme tokens alone, then ship a Retro Pixel built-in theme that uses them.

**Architecture:** Three moves. (1) Split `applyTheme` into a pure resolver plus a thin DOM writer, so the token logic is testable without a DOM. (2) Wrap Tailwind's already-variable-driven tokens (`--spacing`, `--font-sans`) and override the `border` utilities so their widths read a variable. (3) Add six `terra-*` surface classes that act as **variable scopes**, not style overrides: a class sets `--surface-border-width` on the element, which changes what that element's own `border` utility resolves to. Every new variable defaults to the value that renders today, so a theme that sets nothing is byte-identical.

**Tech Stack:** TypeScript, React 19, Tailwind CSS 4.3.2, vitest 4, `@fontsource`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-themable-surfaces-design.md`.
- **No em-dash** anywhere: code, comments, commits, docs.
- **No emojis** anywhere.
- **No AI attribution in commits.** No `Co-Authored-By`, no "Generated with" line.
- **Comments:** default to none. If genuinely needed, 1-2 lines on *why*, never *what*.
- **Imports:** always `@/...`, never relative across modules. Within `src/modules/theme/` the existing files use relative (`./types`); match that locally.
- **pnpm only.** Never npm/npx/yarn.
- **Do not hand-edit `src/components/ui/`.** Those are shadcn primitives (TERRA.md). No task in this plan touches them.
- **There is no DOM test environment.** No jsdom, no happy-dom, no `vitest.config.ts`. All tests must be pure functions. Do not add a DOM environment; Task 2 exists specifically so this stays true.
- Checks before claiming done: `pnpm lint`, `pnpm check-types`, `pnpm test`.

## Scope

This plan covers spec Phases 0 through 3 plus fonts (spec Layer 3). Spec Layer 4 (icon sets, opt-in scrollbars) is deferred to a follow-on plan; it is independently shippable and not needed for a working Retro Pixel theme.

---

### Task 1: Validate custom themes on read

**Files:**
- Modify: `src/modules/theme/customThemes.ts:11-14`
- Test: `src/modules/theme/customThemes.test.ts` (create)

**Interfaces:**
- Consumes: `validateTheme` from `./validateTheme` (existing).
- Produces: `listCustomThemes()` keeps its signature `() => Promise<Theme[]>` but now drops entries that fail validation.

**Why first:** `listCustomThemes` currently returns raw store JSON straight into `applyTheme`. With colors that was low severity. Later tasks route this same data into `box-shadow` and `font-family`, so it must be validated before those land.

- [ ] **Step 1: Write the failing test**

Create `src/modules/theme/customThemes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeStoredThemes } from "./customThemes";

describe("sanitizeStoredThemes", () => {
  it("returns an empty array for a non-array payload", () => {
    expect(sanitizeStoredThemes(null)).toEqual([]);
    expect(sanitizeStoredThemes({ id: "x" })).toEqual([]);
    expect(sanitizeStoredThemes("nope")).toEqual([]);
  });

  it("keeps valid themes", () => {
    const theme = {
      id: "good-one",
      name: "Good",
      variants: { dark: { colors: { background: "#000" } } },
    };
    const out = sanitizeStoredThemes([theme]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("good-one");
  });

  it("drops entries that fail validation without discarding valid siblings", () => {
    const good = {
      id: "good-one",
      name: "Good",
      variants: { dark: { colors: { background: "#000" } } },
    };
    const bad = { id: "Bad Id", name: "Bad", variants: { dark: {} } };
    const out = sanitizeStoredThemes([good, bad, "junk", null]);
    expect(out.map((t) => t.id)).toEqual(["good-one"]);
  });

  it("returns the validated theme, not the raw entry", () => {
    const out = sanitizeStoredThemes([
      {
        id: "good-one",
        name: "  Padded  ",
        variants: { dark: { colors: { background: "#000" } } },
        somethingExtra: "ignored",
      },
    ]);
    expect(out[0].name).toBe("Padded");
    expect(out[0]).not.toHaveProperty("somethingExtra");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/customThemes.test.ts`
Expected: FAIL, `sanitizeStoredThemes` is not exported by `./customThemes`.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/theme/customThemes.ts`, add the import and the function, then use it in `listCustomThemes`:

```ts
import { validateTheme } from "./validateTheme";
```

```ts
export function sanitizeStoredThemes(raw: unknown): Theme[] {
  if (!Array.isArray(raw)) return [];
  const out: Theme[] = [];
  for (const entry of raw) {
    const result = validateTheme(entry);
    if (result.ok) out.push(result.theme);
  }
  return out;
}

export async function listCustomThemes(): Promise<Theme[]> {
  return sanitizeStoredThemes(await store.get<unknown>(KEY));
}
```

Replace the existing `listCustomThemes` body (currently `const v = await store.get<Theme[]>(KEY); return Array.isArray(v) ? v : [];`) with the version above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/customThemes.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/theme/customThemes.ts src/modules/theme/customThemes.test.ts
git commit -m "fix(theme): validate custom themes on read

listCustomThemes returned raw store JSON straight into applyTheme.
Validation only ran on the import and editor-save paths, so a
hand-edited store file reached the DOM unchecked. Upcoming shape and
typography keys feed box-shadow and font-family, so this closes the
boundary before that payload grows."
```

---

### Task 2: Extract a pure theme-variable resolver

**Files:**
- Modify: `src/modules/theme/applyTheme.ts`
- Test: `src/modules/theme/applyTheme.test.ts` (create)

**Interfaces:**
- Produces: `export type ThemeVar = readonly [name: string, value: string];`
- Produces: `export function resolveThemeVars(theme: Theme, mode: ThemeMode): ThemeVar[] | null` returns `null` when the theme has no usable variant.
- Produces: `export const ALL_VARS: readonly string[]` (already exists as a module-local `const`; export it so tests can assert the clear list covers every writable name).
- `applyTheme(theme, mode)` and `clearTheme()` keep their existing signatures and behavior.

**Why:** `applyTheme` is untested and touches `document`. The repo has no DOM test environment and should not grow one. TERRA.md requires new logic to live in pure functions with a thin imperative shell. Splitting the resolver out makes every later token addition testable.

- [ ] **Step 1: Write the failing test**

Create `src/modules/theme/applyTheme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_VARS, resolveThemeVars } from "./applyTheme";
import type { Theme } from "./types";

function theme(over: Partial<Theme> = {}): Theme {
  return {
    id: "t",
    name: "T",
    variants: { dark: { colors: { background: "#000" } } },
    ...over,
  };
}

describe("resolveThemeVars", () => {
  it("maps color keys to their CSS variable names", () => {
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: { colors: { background: "#000", mutedForeground: "#888" } },
        },
      }),
      "dark",
    );
    expect(vars).toEqual(
      expect.arrayContaining([
        ["--background", "#000"],
        ["--muted-foreground", "#888"],
      ]),
    );
  });

  it("maps the terminal palette including all 16 ansi slots", () => {
    const ansi = Array.from({ length: 16 }, (_, i) => `#${i}${i}${i}`);
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            terminal: {
              background: "#111",
              ansi: ansi as unknown as never,
            },
          },
        },
      }),
      "dark",
    );
    const names = vars?.map(([n]) => n) ?? [];
    expect(names).toContain("--terminal-background");
    expect(names).toContain("--terminal-ansi-black");
    expect(names).toContain("--terminal-ansi-bright-white");
  });

  it("falls back to the dark variant when the requested mode is missing", () => {
    const vars = resolveThemeVars(
      theme({ variants: { dark: { colors: { background: "#dark" } } } }),
      "light",
    );
    expect(vars).toContainEqual(["--background", "#dark"]);
  });

  it("falls back to the light variant when only light exists", () => {
    const vars = resolveThemeVars(
      theme({ variants: { light: { colors: { background: "#light" } } } }),
      "dark",
    );
    expect(vars).toContainEqual(["--background", "#light"]);
  });

  it("returns null when no variant exists", () => {
    expect(resolveThemeVars(theme({ variants: {} }), "dark")).toBeNull();
  });

  it("omits keys the variant does not set", () => {
    const vars = resolveThemeVars(theme(), "dark");
    const names = vars?.map(([n]) => n) ?? [];
    expect(names).toEqual(["--background"]);
  });

  it("emits only names that ALL_VARS can clear", () => {
    const ansi = Array.from({ length: 16 }, () => "#000");
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            colors: { background: "#000", radius: "0rem", borderStyle: "dotted" },
            terminal: { background: "#000", ansi: ansi as unknown as never },
          },
        },
      }),
      "dark",
    );
    for (const [name] of vars ?? []) expect(ALL_VARS).toContain(name);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/applyTheme.test.ts`
Expected: FAIL, `resolveThemeVars` and `ALL_VARS` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/theme/applyTheme.ts`, change `const ALL_VARS` to `export const ALL_VARS`, then replace the `applyTheme` / `writeColors` / `writeTerminal` block with:

```ts
export type ThemeVar = readonly [name: string, value: string];

export function resolveThemeVars(theme: Theme, mode: ThemeMode): ThemeVar[] | null {
  const variant =
    theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light;
  if (!variant) return null;
  const out: ThemeVar[] = [];
  if (variant.colors) collectColors(out, variant.colors);
  if (variant.terminal) collectTerminal(out, variant.terminal);
  return out;
}

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const vars = resolveThemeVars(theme, mode);
  if (!vars) {
    clearTheme();
    return;
  }
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  for (const [name, value] of vars) root.style.setProperty(name, value);
  lastApplied = theme.id;
}

function collectColors(out: ThemeVar[], c: ThemeColors): void {
  for (const k of Object.keys(c) as (keyof ThemeColors)[]) {
    const v = c[k];
    if (v) out.push([COLOR_VAR[k], v]);
  }
}

function collectTerminal(out: ThemeVar[], t: TerminalPalette): void {
  if (t.background) out.push(["--terminal-background", t.background]);
  if (t.foreground) out.push(["--terminal-foreground", t.foreground]);
  if (t.cursor) out.push(["--terminal-cursor", t.cursor]);
  if (t.cursorAccent) out.push(["--terminal-cursor-accent", t.cursorAccent]);
  if (t.selection) out.push(["--terminal-selection", t.selection]);
  if (t.ansi) {
    for (let i = 0; i < ANSI_VARS.length && i < t.ansi.length; i++) {
      out.push([ANSI_VARS[i], t.ansi[i]]);
    }
  }
}
```

Delete the now-unused `writeColors` and `writeTerminal`. Keep `clearTheme` and `lastApplied` exactly as they are.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/applyTheme.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass. `check-types` confirms `applyTheme`'s callers in `ThemeProvider.tsx` are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/modules/theme/applyTheme.ts src/modules/theme/applyTheme.test.ts
git commit -m "refactor(theme): split applyTheme into a pure resolver and a DOM writer

resolveThemeVars maps a theme and mode to the variable pairs to write,
so the token logic is testable without a DOM. The repo has no DOM test
environment and does not need one for this. applyTheme keeps its
signature and behavior; the variant fallback and clear-then-set order
are now locked by tests."
```

---

### Task 3: Add shape and typography tokens to the schema

**Files:**
- Modify: `src/modules/theme/types.ts`
- Modify: `src/modules/theme/validateTheme.ts`
- Test: `src/modules/theme/validateTheme.test.ts:112` (append cases inside the existing `describe`)

**Interfaces:**
- Produces: `ThemeShape`, `ThemeTypography` types, exported from `./types`.
- Produces: `ThemeVariant` gains optional `shape?: ThemeShape` and `type?: ThemeTypography`.
- Produces: `LENGTH_RE` guard rejecting anything that is not a plain CSS length.
- `ThemeColors` is unchanged, so all 19 built-ins and every existing `.terra-theme` file keep parsing.

**Note on validation strictness:** shape values land in `border-width` and `box-shadow`. Colors are passed through as free strings today, and shape colors follow that precedent. Lengths do not: they are matched against `LENGTH_RE` so a theme cannot inject a comma or a function call into the shared `box-shadow` declaration built in Task 6.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("validateTheme", ...)` block in `src/modules/theme/validateTheme.test.ts`, before its closing `});`:

```ts
  it("accepts shape lengths and colors", () => {
    const result = validateTheme(
      baseTheme({
        variants: {
          dark: {
            shape: {
              frameWidth: "8px",
              chromeWidth: "6px",
              panelWidth: "4px",
              slotWidth: "4px",
              controlWidth: "3px",
              bevelWidth: "4px",
              bevelOuter: "#8a5a2e",
              bevelMid: "#6b4226",
              bevelInner: "#4a2d16",
              liftColor: "#2a1a0d",
              liftDepth: "6px",
              spacing: "0.25rem",
            },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.variants.dark?.shape?.frameWidth).toBe("8px");
      expect(result.theme.variants.dark?.shape?.bevelOuter).toBe("#8a5a2e");
    }
  });

  it("rejects shape lengths that are not plain CSS lengths", () => {
    for (const bad of [
      "4px, 0 0 99px red",
      "calc(1px + 2px)",
      "url(x)",
      "4",
      "",
    ]) {
      const result = validateTheme(
        baseTheme({ variants: { dark: { shape: { bevelWidth: bad } } } }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("accepts zero as a length", () => {
    const result = validateTheme(
      baseTheme({ variants: { dark: { shape: { bevelWidth: "0" } } } }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unrecognized shape keys", () => {
    const result = validateTheme(
      baseTheme({ variants: { dark: { shape: { nope: "1px" } } } }),
    );
    expect(result).toEqual({
      ok: false,
      error: "variants.dark.shape.nope is not a recognized shape key",
    });
  });

  it("accepts typography keys and allowlists chromeTransform", () => {
    const ok = validateTheme(
      baseTheme({
        variants: {
          dark: {
            type: {
              sans: "'Press Start 2P', monospace",
              display: "'Press Start 2P', monospace",
              chromeTracking: "1px",
              chromeTransform: "uppercase",
            },
          },
        },
      }),
    );
    expect(ok.ok).toBe(true);
    const bad = validateTheme(
      baseTheme({
        variants: { dark: { type: { chromeTransform: "capitalize; x:y" } } },
      }),
    );
    expect(bad.ok).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/validateTheme.test.ts`
Expected: FAIL, shape keys are rejected because `parseVariant` does not know them.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/theme/types.ts`, add above `ThemeVariant`:

```ts
export const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase"] as const;

export type TextTransform = (typeof TEXT_TRANSFORMS)[number];

export type ThemeShape = Partial<{
  frameWidth: string;
  chromeWidth: string;
  panelWidth: string;
  slotWidth: string;
  controlWidth: string;
  bevelWidth: string;
  bevelOuter: string;
  bevelMid: string;
  bevelInner: string;
  liftColor: string;
  liftDepth: string;
  spacing: string;
}>;

export type ThemeTypography = Partial<{
  sans: string;
  mono: string;
  display: string;
  chromeTracking: string;
  chromeTransform: TextTransform;
}>;
```

Change `ThemeVariant` to:

```ts
export type ThemeVariant = {
  colors?: ThemeColors;
  terminal?: TerminalPalette;
  shape?: ThemeShape;
  type?: ThemeTypography;
};
```

In `src/modules/theme/validateTheme.ts`, extend the imports from `./types` with `TEXT_TRANSFORMS`, `type TextTransform`, `type ThemeShape`, `type ThemeTypography`, then add:

```ts
const SHAPE_LENGTH_KEYS: readonly (keyof ThemeShape)[] = [
  "frameWidth", "chromeWidth", "panelWidth", "slotWidth", "controlWidth",
  "bevelWidth", "liftDepth", "spacing",
];

const SHAPE_COLOR_KEYS: readonly (keyof ThemeShape)[] = [
  "bevelOuter", "bevelMid", "bevelInner", "liftColor",
];

// Lengths compose into a shared box-shadow, so they are matched rather than
// passed through: a comma or a function call would rewrite the declaration.
const LENGTH_RE = /^(0|-?\d+(\.\d+)?(px|rem|em))$/;

const TYPE_STRING_KEYS = ["sans", "mono", "display", "chromeTracking"] as const;

function parseShape(raw: unknown, path: string): ThemeShape | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return `${path} must be an object`;
  const out: ThemeShape = {};
  for (const k of Object.keys(raw)) {
    const isLength = (SHAPE_LENGTH_KEYS as string[]).includes(k);
    const isColor = (SHAPE_COLOR_KEYS as string[]).includes(k);
    if (!isLength && !isColor) {
      return `${path}.${k} is not a recognized shape key`;
    }
    const v = raw[k];
    if (!isStr(v) || v.length === 0) {
      return `${path}.${k} must be a non-empty string`;
    }
    if (isLength && !LENGTH_RE.test(v)) {
      return `${path}.${k} must be a CSS length such as 4px or 0`;
    }
    out[k as keyof ThemeShape] = v;
  }
  return out;
}

function parseTypography(raw: unknown, path: string): ThemeTypography | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return `${path} must be an object`;
  const out: ThemeTypography = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (!isStr(v) || v.length === 0) {
      return `${path}.${k} must be a non-empty string`;
    }
    if (k === "chromeTransform") {
      if (!(TEXT_TRANSFORMS as readonly string[]).includes(v)) {
        return `${path}.chromeTransform must be one of: ${TEXT_TRANSFORMS.join(", ")}`;
      }
      out.chromeTransform = v as TextTransform;
      continue;
    }
    if (!(TYPE_STRING_KEYS as readonly string[]).includes(k)) {
      return `${path}.${k} is not a recognized typography key`;
    }
    out[k as (typeof TYPE_STRING_KEYS)[number]] = v;
  }
  return out;
}
```

Replace `parseVariant` with:

```ts
function parseVariant(raw: unknown, path: string): ThemeVariant | string {
  if (!isObj(raw)) return `${path} must be an object`;
  const colors = parseColors(raw.colors, `${path}.colors`);
  if (typeof colors === "string") return colors;
  const terminal = parseTerminal(raw.terminal, `${path}.terminal`);
  if (typeof terminal === "string") return terminal;
  const shape = parseShape(raw.shape, `${path}.shape`);
  if (typeof shape === "string") return shape;
  const type = parseTypography(raw.type, `${path}.type`);
  if (typeof type === "string") return type;
  return { colors, terminal, shape, type };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/validateTheme.test.ts`
Expected: PASS, all existing cases plus 5 new ones.

- [ ] **Step 5: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass, including `themes/builtins.test.ts` which round-trips all 19 built-ins through `validateTheme`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/theme/types.ts src/modules/theme/validateTheme.ts src/modules/theme/validateTheme.test.ts
git commit -m "feat(theme): add shape and typography token groups

ThemeVariant gains optional shape and type siblings next to colors and
terminal. ThemeColors is untouched, so every existing theme file parses
unchanged.

Shape lengths compose into a shared box-shadow, so unlike colors they
are matched against a length pattern rather than passed through: a
comma or a function call in one value would rewrite the whole
declaration."
```

---

### Task 4: Write the new tokens as CSS variables

**Files:**
- Modify: `src/modules/theme/applyTheme.ts`
- Test: `src/modules/theme/applyTheme.test.ts` (append)

**Interfaces:**
- Consumes: `ThemeShape`, `ThemeTypography` from Task 3; `resolveThemeVars`, `ALL_VARS` from Task 2.
- Produces: `ALL_VARS` grows to include every new variable name, so `clearTheme` and the clear-then-set step in `applyTheme` still remove all of them.

Variable names (these exact strings are consumed by Tasks 5, 6 and 9):

| Token | Variable |
|---|---|
| `shape.frameWidth` | `--frame-border-width` |
| `shape.chromeWidth` | `--chrome-border-width` |
| `shape.panelWidth` | `--panel-border-width` |
| `shape.slotWidth` | `--slot-border-width` |
| `shape.controlWidth` | `--control-border-width` |
| `shape.bevelWidth` | `--bevel-width` |
| `shape.bevelOuter` | `--bevel-outer` |
| `shape.bevelMid` | `--bevel-mid` |
| `shape.bevelInner` | `--bevel-inner` |
| `shape.liftColor` | `--lift-color` |
| `shape.liftDepth` | `--lift-depth` |
| `shape.spacing` | `--ui-spacing` |
| `type.sans` | `--ui-font-sans` |
| `type.mono` | `--ui-font-mono` |
| `type.display` | `--ui-font-display` |
| `type.chromeTracking` | `--chrome-tracking` |
| `type.chromeTransform` | `--chrome-transform` |

- [ ] **Step 1: Write the failing test**

Append to `src/modules/theme/applyTheme.test.ts`, inside the existing `describe`:

```ts
  it("maps shape tokens to their CSS variable names", () => {
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            shape: {
              frameWidth: "8px",
              chromeWidth: "6px",
              panelWidth: "4px",
              slotWidth: "4px",
              controlWidth: "3px",
              bevelWidth: "4px",
              bevelOuter: "#8a5a2e",
              bevelMid: "#6b4226",
              bevelInner: "#4a2d16",
              liftColor: "#2a1a0d",
              liftDepth: "6px",
              spacing: "0.3rem",
            },
          },
        },
      }),
      "dark",
    );
    expect(vars).toEqual(
      expect.arrayContaining([
        ["--frame-border-width", "8px"],
        ["--chrome-border-width", "6px"],
        ["--panel-border-width", "4px"],
        ["--slot-border-width", "4px"],
        ["--control-border-width", "3px"],
        ["--bevel-width", "4px"],
        ["--bevel-outer", "#8a5a2e"],
        ["--bevel-mid", "#6b4226"],
        ["--bevel-inner", "#4a2d16"],
        ["--lift-color", "#2a1a0d"],
        ["--lift-depth", "6px"],
        ["--ui-spacing", "0.3rem"],
      ]),
    );
  });

  it("maps typography tokens to their CSS variable names", () => {
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            type: {
              sans: "'VT323', monospace",
              mono: "'VT323', monospace",
              display: "'Press Start 2P', monospace",
              chromeTracking: "1px",
              chromeTransform: "uppercase",
            },
          },
        },
      }),
      "dark",
    );
    expect(vars).toEqual(
      expect.arrayContaining([
        ["--ui-font-sans", "'VT323', monospace"],
        ["--ui-font-mono", "'VT323', monospace"],
        ["--ui-font-display", "'Press Start 2P', monospace"],
        ["--chrome-tracking", "1px"],
        ["--chrome-transform", "uppercase"],
      ]),
    );
  });

  it("keeps ALL_VARS a superset of every emitted shape and type name", () => {
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            shape: { frameWidth: "8px", bevelOuter: "#000", spacing: "1rem" },
            type: { sans: "x", display: "y", chromeTransform: "uppercase" },
          },
        },
      }),
      "dark",
    );
    for (const [name] of vars ?? []) expect(ALL_VARS).toContain(name);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/applyTheme.test.ts`
Expected: FAIL, the shape and type arrays are empty because nothing collects them.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/theme/applyTheme.ts`, extend the type import with `ThemeShape` and `ThemeTypography`, then add the maps next to `COLOR_VAR`:

```ts
const SHAPE_VAR: Record<keyof ThemeShape, string> = {
  frameWidth: "--frame-border-width",
  chromeWidth: "--chrome-border-width",
  panelWidth: "--panel-border-width",
  slotWidth: "--slot-border-width",
  controlWidth: "--control-border-width",
  bevelWidth: "--bevel-width",
  bevelOuter: "--bevel-outer",
  bevelMid: "--bevel-mid",
  bevelInner: "--bevel-inner",
  liftColor: "--lift-color",
  liftDepth: "--lift-depth",
  spacing: "--ui-spacing",
};

const TYPE_VAR: Record<keyof ThemeTypography, string> = {
  sans: "--ui-font-sans",
  mono: "--ui-font-mono",
  display: "--ui-font-display",
  chromeTracking: "--chrome-tracking",
  chromeTransform: "--chrome-transform",
};
```

Extend `ALL_VARS`:

```ts
export const ALL_VARS: readonly string[] = [
  ...Object.values(COLOR_VAR),
  ...Object.values(SHAPE_VAR),
  ...Object.values(TYPE_VAR),
  "--terminal-background",
  "--terminal-foreground",
  "--terminal-cursor",
  "--terminal-cursor-accent",
  "--terminal-selection",
  ...ANSI_VARS,
];
```

Add the collectors and call them from `resolveThemeVars`:

```ts
function collectShape(out: ThemeVar[], s: ThemeShape): void {
  for (const k of Object.keys(s) as (keyof ThemeShape)[]) {
    const v = s[k];
    if (v) out.push([SHAPE_VAR[k], v]);
  }
}

function collectType(out: ThemeVar[], t: ThemeTypography): void {
  for (const k of Object.keys(t) as (keyof ThemeTypography)[]) {
    const v = t[k];
    if (v) out.push([TYPE_VAR[k], v]);
  }
}
```

In `resolveThemeVars`, after the terminal line:

```ts
  if (variant.shape) collectShape(out, variant.shape);
  if (variant.type) collectType(out, variant.type);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/applyTheme.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/theme/applyTheme.ts src/modules/theme/applyTheme.test.ts
git commit -m "feat(theme): write shape and typography tokens as CSS variables

ALL_VARS grows with them, so clearTheme and the clear-then-set step in
applyTheme still remove every name a theme can write. No CSS consumes
these yet, so rendering is unchanged."
```

---

### Task 5: Make Tailwind's tokens reachable

**Files:**
- Modify: `src/styles/globals.css:11-51` (the `@theme inline` block) and append a `@utility` block
- Test: `src/styles/tailwindTokens.test.ts` (create)

**Interfaces:**
- Produces: `.border`, `.border-t`, `.border-b`, `.border-l`, `.border-r` resolve `var(--surface-border-width, 1px)`.
- Produces: `--spacing`, `--font-sans`, `--font-mono` route through `--ui-spacing`, `--ui-font-sans`, `--ui-font-mono` with today's values as fallbacks.

**This is the zero-change task.** Every wrap keeps the current value as the fallback, so with no variable set the compiled CSS is equivalent to today's. The test locks that.

**Known ordering detail:** Tailwind emits the custom `.border` after `.border-2` in the utilities layer, so an element carrying both would take the variable. The repo has exactly two non-1px sites, `src/components/ui/switch.tsx:18` (`border-2`) and `src/modules/git-history/GitHistoryPane.tsx:714` (`border-l-2`), and neither combines with a bare `border`. Step 1 includes a test that fails if that ever changes.

- [ ] **Step 1: Write the failing test**

Create `src/styles/tailwindTokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

async function build(source: string, candidates: string[]): Promise<string> {
  const compiler = await compile(source, {
    base: ROOT,
    loadStylesheet: async () => {
      const p = path.resolve(ROOT, "node_modules/tailwindcss/index.css");
      return { path: p, base: path.dirname(p), content: readFileSync(p, "utf8") };
    },
  });
  return compiler.build(candidates);
}

const GLOBALS = readFileSync(
  path.resolve(ROOT, "src/styles/globals.css"),
  "utf8",
);

const OVERRIDE_LINES = GLOBALS.split("\n").filter((l) =>
  l.trimStart().startsWith("@utility border"),
);

describe("border width overrides", () => {
  it("declares one override per border edge utility, each falling back to 1px", () => {
    expect(OVERRIDE_LINES).toHaveLength(5);
    for (const line of OVERRIDE_LINES) {
      expect(line).toContain("var(--surface-border-width, 1px)");
    }
  });

  it("compiles so every edge utility reads the variable", async () => {
    const css = await build(
      `@import "tailwindcss";\n${OVERRIDE_LINES.join("\n")}`,
      ["border", "border-t", "border-b", "border-l", "border-r"],
    );
    for (const prop of [
      "border-width",
      "border-top-width",
      "border-bottom-width",
      "border-left-width",
      "border-right-width",
    ]) {
      expect(css).toContain(`${prop}: var(--surface-border-width, 1px)`);
    }
  });

  it("keeps the wrapped theme tokens falling back to today's values", () => {
    expect(GLOBALS).toContain(
      "--font-sans: var(--ui-font-sans, 'Inter Variable', sans-serif)",
    );
    expect(GLOBALS).toContain(
      "--font-mono: var(--ui-font-mono, 'JetBrains Mono', monospace)",
    );
    expect(GLOBALS).toContain("--spacing: var(--ui-spacing, 0.25rem)");
  });
});

describe("no element combines a bare border with an explicit width", () => {
  it("holds across the source tree", async () => {
    const { globSync } = await import("node:fs");
    const files = globSync("src/**/*.tsx", { cwd: ROOT });
    const offenders: string[] = [];
    for (const rel of files) {
      const src = readFileSync(path.resolve(ROOT, rel), "utf8");
      for (const m of src.matchAll(/class(?:Name)?="([^"]*)"/g)) {
        const classes = m[1].split(/\s+/);
        const bare = classes.includes("border");
        const sized = classes.some((c) => /^border(-[trblxy])?-\d+$/.test(c));
        if (bare && sized) offenders.push(`${rel}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/styles/tailwindTokens.test.ts`
Expected: FAIL on the first two cases, no `@utility border` block exists yet. The third case should already PASS.

- [ ] **Step 3: Write minimal implementation**

In `src/styles/globals.css`, inside the existing `@theme inline` block, replace these three lines:

```css
    --font-sans: 'Inter Variable', sans-serif;
```

with:

```css
    --font-sans: var(--ui-font-sans, 'Inter Variable', sans-serif);
    --font-mono: var(--ui-font-mono, 'JetBrains Mono', monospace);
    --spacing: var(--ui-spacing, 0.25rem);
```

Then append after the `@theme inline` block:

```css
/* Border width is emitted by the utility itself, not by preflight, so a base
 * layer rule cannot reach it. These overrides re-emit the same utilities
 * reading a variable; the 1px fallback keeps opted-out themes identical. */
@utility border   { border-width: var(--surface-border-width, 1px); }
@utility border-t { border-top-width: var(--surface-border-width, 1px); }
@utility border-b { border-bottom-width: var(--surface-border-width, 1px); }
@utility border-l { border-left-width: var(--surface-border-width, 1px); }
@utility border-r { border-right-width: var(--surface-border-width, 1px); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/styles/tailwindTokens.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify zero visual change by hand**

Run: `pnpm dev`
Expected: the app is visually identical. Cycle through Terra Default, Wireframe, and Arcade and confirm nothing shifted. Confirm the `terminalFontFamily` setting still overrides the terminal font (it is applied per-xterm, not via `--font-mono`, so it must be unaffected).

- [ ] **Step 6: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/styles/globals.css src/styles/tailwindTokens.test.ts
git commit -m "feat(styles): route spacing, fonts and border width through variables

Tailwind drives --spacing and --text-* from variables already; wrapping
them costs two lines and reaches all 213 spacing and sizing utilities.
--font-sans was authored as a literal inside @theme inline, which
inlines the value, so setting it at runtime did nothing until now.

Border width needs a @utility override because the width is emitted by
the utility, not by preflight, so the base layer rule used for
border-style cannot reach it. Every fallback is the current value, so a
theme that sets nothing renders identically."
```

---

### Task 6: Add the surface classes

**Files:**
- Modify: `src/styles/globals.css` (append a `@layer components` block)
- Test: `src/styles/surfaceClasses.test.ts` (create)

**Interfaces:**
- Produces: `.terra-frame`, `.terra-chrome`, `.terra-panel`, `.terra-slot`, `.terra-control`, `.terra-chrome-label`.

**Mechanism, and why it is not a specificity fight:** each class sets `--surface-border-width` **on the element**. The element's own `border`/`border-b` utility from Task 5 reads that variable, so the width changes without any rule competing on `border-width`. A component's explicit `border-b-0` still wins because it sets the property directly. This is why the classes can live in `@layer components` safely.

- [ ] **Step 1: Write the failing test**

Create `src/styles/surfaceClasses.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "globals.css"),
  "utf8",
);

function block(selector: string): string {
  const i = CSS.indexOf(`${selector} {`);
  expect(i, `${selector} not found in globals.css`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf("}", i));
}

describe("surface classes", () => {
  it.each([
    [".terra-frame", "--frame-border-width"],
    [".terra-chrome", "--chrome-border-width"],
    [".terra-panel", "--panel-border-width"],
    [".terra-slot", "--slot-border-width"],
    [".terra-control", "--control-border-width"],
  ])("%s scopes --surface-border-width from %s", (selector, token) => {
    const b = block(selector);
    expect(b).toContain(`--surface-border-width: var(${token}, 1px)`);
  });

  it("defaults every bevel input to a no-op", () => {
    for (const decl of [
      "--bevel-width: 0px",
      "--bevel-outer: transparent",
      "--bevel-mid: transparent",
      "--bevel-inner: transparent",
      "--lift-color: transparent",
      "--lift-depth: 0px",
    ]) {
      expect(CSS).toContain(decl);
    }
  });

  it("gives chrome labels inert typography defaults", () => {
    const b = block(".terra-chrome-label");
    expect(b).toContain("var(--chrome-tracking, inherit)");
    expect(b).toContain("var(--chrome-transform, none)");
    expect(b).toContain("var(--ui-font-display, inherit)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/styles/surfaceClasses.test.ts`
Expected: FAIL, none of the selectors exist.

- [ ] **Step 3: Write minimal implementation**

Append to `src/styles/globals.css`:

```css
:root {
  --bevel-width: 0px;
  --bevel-outer: transparent;
  --bevel-mid: transparent;
  --bevel-inner: transparent;
  --lift-color: transparent;
  --lift-depth: 0px;
}

/* Surface classes are variable scopes, not style overrides. Setting
 * --surface-border-width on the element changes what that element's own
 * border utility resolves to, so nothing competes on border-width and an
 * explicit border-b-0 still wins. */
@layer components {
  .terra-frame {
    --surface-border-width: var(--frame-border-width, 1px);
    box-shadow:
      inset 0 0 0 calc(var(--bevel-width) * 1) var(--bevel-outer),
      inset 0 0 0 calc(var(--bevel-width) * 2) var(--bevel-mid),
      inset 0 0 0 calc(var(--bevel-width) * 3) var(--bevel-inner),
      0 var(--lift-depth) 0 var(--lift-color);
  }

  .terra-chrome {
    --surface-border-width: var(--chrome-border-width, 1px);
  }

  .terra-panel {
    --surface-border-width: var(--panel-border-width, 1px);
    box-shadow:
      inset 0 0 0 calc(var(--bevel-width) * 1) var(--bevel-outer),
      inset 0 0 0 calc(var(--bevel-width) * 2) var(--bevel-mid),
      inset 0 0 0 calc(var(--bevel-width) * 3) var(--bevel-inner);
  }

  .terra-slot {
    --surface-border-width: var(--slot-border-width, 1px);
    box-shadow: inset 0 0 0 var(--bevel-width) var(--bevel-outer);
  }

  .terra-control {
    --surface-border-width: var(--control-border-width, 1px);
  }

  .terra-chrome-label {
    font-family: var(--ui-font-display, inherit);
    letter-spacing: var(--chrome-tracking, inherit);
    text-transform: var(--chrome-transform, none);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/styles/surfaceClasses.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass. No component uses the classes yet, so nothing renders differently.

- [ ] **Step 6: Commit**

```bash
git add src/styles/globals.css src/styles/surfaceClasses.test.ts
git commit -m "feat(styles): add terra surface classes as variable scopes

Each class sets --surface-border-width on the element, so the element's
own border utility resolves to the scoped width. Nothing competes on
border-width, which is why these can sit in the components layer without
overriding a deliberate border-b-0.

Bevel inputs default to 0px and transparent, so the shared box-shadow
computes to a no-op until a theme opts in."
```

---

### Task 7: Apply the surface classes to Terra's chrome

**Files:**
- Modify: `src/modules/header/Header.tsx:108`
- Modify: `src/modules/statusbar/StatusBar.tsx:32`
- Modify: `src/modules/explorer/FileExplorer.tsx` (the panel root and its section header)
- Modify: `src/styles/globals.css:194-200` (the borderless chrome `#root` rule)

**Interfaces:**
- Consumes: the classes from Task 6.
- No exported API changes.

**Constraint:** do not touch `src/components/ui/`. Those are shadcn primitives. Buttons pick up `--surface-border-width` globally from Task 5, which is sufficient.

- [ ] **Step 1: Add the class to the header**

In `src/modules/header/Header.tsx:108`, change the className template's leading literal from:

```tsx
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
```

to:

```tsx
      className={`terra-chrome flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
```

- [ ] **Step 2: Add the class to the status bar**

In `src/modules/statusbar/StatusBar.tsx:32`, change:

```tsx
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 pl-3 pr-4 text-[11px]">
```

to:

```tsx
    <footer className="terra-chrome flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 pl-3 pr-4 text-[11px]">
```

- [ ] **Step 3: Add the classes to the explorer panel and its header**

In `src/modules/explorer/FileExplorer.tsx:487`, change:

```tsx
        className="flex h-full flex-col outline-none"
```

to:

```tsx
        className="terra-panel flex h-full flex-col outline-none"
```

At `:491`, change:

```tsx
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
```

to:

```tsx
        <div className="terra-chrome flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
```

At `:493`, change:

```tsx
            className="flex flex-1 items-center truncate text-xs font-medium text-foreground/80"
```

to:

```tsx
            className="terra-chrome-label flex flex-1 items-center truncate text-xs font-medium text-foreground/80"
```

- [ ] **Step 4: Add the frame class to the borderless window root**

In `src/styles/globals.css`, the rule at roughly line 194 currently reads:

```css
html[data-chrome="borderless"] #root,
html[data-chrome="borderless"] #settings-root {
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--background);
}
```

Change the two hardcoded values so a theme can reach them:

```css
html[data-chrome="borderless"] #root,
html[data-chrome="borderless"] #settings-root {
  height: 100%;
  border-radius: var(--radius, 12px);
  overflow: hidden;
  border: var(--frame-border-width, 1px) solid var(--border);
  background: var(--background);
}
```

Apply the same `border-radius: var(--radius, 12px)` change to the `.terra-bg-surface` rule at roughly line 175.

Note: `--radius` defaults differ from `12px`, so verify in Step 6 that the borderless corner radius still looks right under Terra Default. If it visibly changes, revert these two to `12px` and instead add a dedicated `--frame-radius` token in a follow-up; do not ship a visible default change in this task.

- [ ] **Step 5: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass.

- [ ] **Step 6: Verify no visual change**

Run: `pnpm dev`
Expected: identical rendering under Terra Default, Wireframe and Arcade. Check the window corner radius on Linux specifically, since that is where `data-chrome="borderless"` applies.

- [ ] **Step 7: Commit**

```bash
git add src/modules/header/Header.tsx src/modules/statusbar/StatusBar.tsx src/modules/explorer/FileExplorer.tsx src/styles/globals.css
git commit -m "feat(ui): mark chrome, panel and frame surfaces

Adds the terra-chrome, terra-panel and terra-chrome-label classes to the
header, status bar and explorer, and routes the borderless window frame
border through --frame-border-width. Every token still defaults to the
current value, so rendering is unchanged.

shadcn primitives under components/ui are left alone; buttons pick up
the global surface width from the border utility override."
```

---

### Task 8: Bundle and lazily load theme fonts

**Files:**
- Modify: `package.json` (add two `@fontsource` dependencies)
- Create: `src/modules/theme/fonts.ts`
- Modify: `src/modules/theme/ThemeProvider.tsx`
- Modify: `src/modules/theme/types.ts` (add `fonts` to `ThemeTypography`)
- Modify: `src/modules/theme/validateTheme.ts` (validate `fonts`)
- Test: `src/modules/theme/fonts.test.ts` (create)

**Interfaces:**
- Produces: `export const FONT_IDS = ["press-start-2p", "vt323"] as const;`
- Produces: `export type FontId = (typeof FONT_IDS)[number];`
- Produces: `export function isFontId(v: unknown): v is FontId`
- Produces: `export function loadFonts(ids: readonly FontId[]): Promise<void>`
- `ThemeTypography` gains `fonts?: readonly FontId[]`.

**Why lazy:** TERRA.md requires unused features to consume zero resources. A theme that names no fonts must not pull font CSS into the eager bundle.

- [ ] **Step 1: Add the dependencies**

Run:

```bash
pnpm add @fontsource/press-start-2p @fontsource/vt323
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/theme/fonts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FONT_IDS, isFontId } from "./fonts";

describe("isFontId", () => {
  it("accepts every bundled id", () => {
    for (const id of FONT_IDS) expect(isFontId(id)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["comic-sans", "", null, 3, {}]) {
      expect(isFontId(bad)).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/fonts.test.ts`
Expected: FAIL, `./fonts` does not exist.

- [ ] **Step 4: Write the implementation**

Create `src/modules/theme/fonts.ts`:

```ts
export const FONT_IDS = ["press-start-2p", "vt323"] as const;

export type FontId = (typeof FONT_IDS)[number];

export function isFontId(v: unknown): v is FontId {
  return typeof v === "string" && (FONT_IDS as readonly string[]).includes(v);
}

const loaded = new Set<FontId>();

// Font CSS is imported only when a theme names it, so an unused face costs
// nothing in the eager bundle.
const LOADERS: Record<FontId, () => Promise<unknown>> = {
  "press-start-2p": () => import("@fontsource/press-start-2p"),
  vt323: () => import("@fontsource/vt323"),
};

export async function loadFonts(ids: readonly FontId[]): Promise<void> {
  await Promise.all(
    ids
      .filter((id) => !loaded.has(id))
      .map(async (id) => {
        await LOADERS[id]();
        loaded.add(id);
      }),
  );
}
```

In `src/modules/theme/types.ts`, add to `ThemeTypography`:

```ts
  fonts: readonly FontId[];
```

and import the type: `import type { FontId } from "./fonts";`

In `src/modules/theme/validateTheme.ts`, import `isFontId` from `./fonts` and add to `parseTypography`, before the `TYPE_STRING_KEYS` check:

```ts
    if (k === "fonts") {
      if (!Array.isArray(raw.fonts) || !raw.fonts.every(isFontId)) {
        return `${path}.fonts must be an array of bundled font ids`;
      }
      out.fonts = raw.fonts;
      continue;
    }
```

Note that the existing `if (!isStr(v) || v.length === 0)` guard runs before this and would reject an array, so move the `fonts` branch above that guard.

In `src/modules/theme/ThemeProvider.tsx`, inside the effect at line 137 that calls `applyTheme`, before applying:

```ts
    const resolved = resolveTheme(effectiveId, customThemes);
    const fonts =
      resolved.variants[resolvedMode]?.type?.fonts ??
      resolved.variants.dark?.type?.fonts ??
      resolved.variants.light?.type?.fonts;
    if (fonts?.length) void loadFonts(fonts);
    applyTheme(resolved, resolvedMode);
```

with `import { loadFonts } from "./fonts";` added at the top.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/fonts.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verify the fonts stay out of the eager bundle**

Run: `pnpm build`
Expected: `press-start-2p` and `vt323` CSS appear as separate chunks, not inside the main entry. If the repo has an eager-budget check (`eager-budget.json`), confirm it still passes.

- [ ] **Step 7: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/modules/theme/fonts.ts src/modules/theme/fonts.test.ts src/modules/theme/types.ts src/modules/theme/validateTheme.ts src/modules/theme/ThemeProvider.tsx
git commit -m "feat(theme): let themes name bundled fonts, loaded lazily

A theme lists font ids from a bundled registry rather than a family
string that may not exist on the machine. Each face is a dynamic import
fired only when the active theme names it, so an unused font costs
nothing in the eager bundle."
```

---

### Task 9: Author the Retro Pixel built-in theme

**Files:**
- Create: `src/modules/theme/themes/retro-pixel.ts`
- Modify: `src/modules/theme/themes/index.ts`
- Test: covered by the existing `src/modules/theme/themes/builtins.test.ts`

**Interfaces:**
- Consumes: every token from Tasks 3, 4, 6 and 8.
- Produces: `export const retroPixel: Theme` with id `retro-pixel`.

Palette and measurements are transcribed from the spec's reference table.

- [ ] **Step 1: Create the theme**

Create `src/modules/theme/themes/retro-pixel.ts`:

```ts
import type { Theme } from "../types";

// Wood-plate palette from the Terra Retro Pixel UI reference: cream slots on a
// tan panel, four ink tones stacked into the frame bevel. Radius stays 0 and
// the bevel does the work that a shadow would do in a soft theme.
export const retroPixel: Theme = {
  id: "retro-pixel",
  name: "Retro Pixel",
  description: "Wooden plate, heavy ink bevels, pixel display type.",
  editorTheme: { light: "solarized-light", dark: "solarized-light" },
  variants: {
    light: {
      colors: {
        background: "#deb887",
        foreground: "#4a2d16",
        card: "#f4e4bc",
        cardForeground: "#4a2d16",
        popover: "#f4e4bc",
        popoverForeground: "#4a2d16",
        primary: "#c76b3c",
        primaryForeground: "#f4e4bc",
        secondary: "#c9a366",
        secondaryForeground: "#3a230f",
        muted: "#c9a366",
        mutedForeground: "#8a6a4a",
        accent: "#c9a366",
        accentForeground: "#3a230f",
        destructive: "#c0392b",
        border: "#4a2d16",
        input: "#6b4226",
        ring: "#c76b3c",
        sidebar: "#deb887",
        sidebarForeground: "#4a2d16",
        sidebarPrimary: "#c76b3c",
        sidebarPrimaryForeground: "#f4e4bc",
        sidebarAccent: "#c9a366",
        sidebarAccentForeground: "#3a230f",
        sidebarBorder: "#4a2d16",
        sidebarRing: "#c76b3c",
        radius: "0rem",
        borderStyle: "solid",
      },
      shape: {
        frameWidth: "8px",
        chromeWidth: "6px",
        panelWidth: "4px",
        slotWidth: "4px",
        controlWidth: "3px",
        bevelWidth: "4px",
        bevelOuter: "#8a5a2e",
        bevelMid: "#6b4226",
        bevelInner: "#4a2d16",
        liftColor: "#2a1a0d",
        liftDepth: "6px",
      },
      type: {
        sans: "'VT323', monospace",
        mono: "'VT323', monospace",
        display: "'Press Start 2P', monospace",
        chromeTracking: "1px",
        chromeTransform: "uppercase",
        fonts: ["press-start-2p", "vt323"],
      },
      terminal: {
        background: "#f4e4bc",
        foreground: "#4a2d16",
        cursor: "#4a2d16",
        cursorAccent: "#f4e4bc",
        selection: "rgba(199,107,60,0.30)",
        ansi: [
          "#3a230f", "#c0392b", "#7a9a5a", "#c9a366",
          "#5a8a9a", "#8a5a2e", "#5a8a9a", "#8a6a4a",
          "#6b4226", "#d4553f", "#8fae6a", "#deb887",
          "#6fa0b0", "#a97c50", "#6fa0b0", "#f4e4bc",
        ],
      },
    },
    dark: {
      colors: {
        background: "#3a230f",
        foreground: "#deb887",
        card: "#4a2d16",
        cardForeground: "#f4e4bc",
        popover: "#4a2d16",
        popoverForeground: "#f4e4bc",
        primary: "#c76b3c",
        primaryForeground: "#241708",
        secondary: "#6b4226",
        secondaryForeground: "#f4e4bc",
        muted: "#6b4226",
        mutedForeground: "#a97c50",
        accent: "#6b4226",
        accentForeground: "#f4e4bc",
        destructive: "#c0392b",
        border: "#c9a366",
        input: "#a97c50",
        ring: "#c76b3c",
        sidebar: "#2a1a0d",
        sidebarForeground: "#deb887",
        sidebarPrimary: "#c76b3c",
        sidebarPrimaryForeground: "#241708",
        sidebarAccent: "#6b4226",
        sidebarAccentForeground: "#f4e4bc",
        sidebarBorder: "#c9a366",
        sidebarRing: "#c76b3c",
        radius: "0rem",
        borderStyle: "solid",
      },
      shape: {
        frameWidth: "8px",
        chromeWidth: "6px",
        panelWidth: "4px",
        slotWidth: "4px",
        controlWidth: "3px",
        bevelWidth: "4px",
        bevelOuter: "#8a5a2e",
        bevelMid: "#a97c50",
        bevelInner: "#c9a366",
        liftColor: "#1a1006",
        liftDepth: "6px",
      },
      type: {
        sans: "'VT323', monospace",
        mono: "'VT323', monospace",
        display: "'Press Start 2P', monospace",
        chromeTracking: "1px",
        chromeTransform: "uppercase",
        fonts: ["press-start-2p", "vt323"],
      },
      terminal: {
        background: "#3a230f",
        foreground: "#deb887",
        cursor: "#deb887",
        cursorAccent: "#3a230f",
        selection: "rgba(199,107,60,0.35)",
        ansi: [
          "#2a1a0d", "#c0392b", "#7a9a5a", "#c9a366",
          "#5a8a9a", "#a97c50", "#6fa0b0", "#deb887",
          "#6b4226", "#d4553f", "#8fae6a", "#e0c88a",
          "#7ab0c0", "#c79a6a", "#8ac4c4", "#f4e4bc",
        ],
      },
    },
  },
};
```

- [ ] **Step 2: Register it**

In `src/modules/theme/themes/index.ts`, add `import { retroPixel } from "./retro-pixel";` in alphabetical position among the imports, and add `retroPixel` to the end of the `BUILTIN` array.

- [ ] **Step 3: Run the built-in test suite**

Run: `pnpm vitest run src/modules/theme/themes/builtins.test.ts`
Expected: PASS. `retro-pixel` round-trips through `validateTheme`, has no duplicate id, and is indexed. It declares both variants with matching color keys.

- [ ] **Step 4: Extend the both-variants check to the new theme**

In `src/modules/theme/themes/builtins.test.ts:34`, change:

```ts
describe.each(["organic", "poster", "wireframe", "arcade"])("%s", (id) => {
```

to:

```ts
describe.each(["organic", "poster", "wireframe", "arcade", "retro-pixel"])(
  "%s",
  (id) => {
```

and close the call with `},\n);` to match.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/themes/builtins.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify in the app**

Run: `pnpm dev`
Expected: selecting Retro Pixel from the command palette or Settings gives the wood palette, 0 radius, thick frames on the header, status bar and explorer, bevel rings on the panel, and the pixel display font on chrome labels. Toggle light and dark. Switch back to Terra Default and confirm everything returns to normal.

- [ ] **Step 7: Run full checks**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/modules/theme/themes/retro-pixel.ts src/modules/theme/themes/index.ts src/modules/theme/themes/builtins.test.ts
git commit -m "feat(theme): add Retro Pixel built-in theme

Transcribed from the Terra Retro Pixel UI reference: wood plate, four
ink tones stacked into the frame bevel, VT323 body with Press Start 2P
on chrome labels. First theme to exercise the shape and typography
token groups."
```

---

## Deferred

Not in this plan, each independently shippable:

- **Icon sets** (spec Layer 4). `explorer/lib/iconResolver.ts:1` eagerly imports `@iconify-json/catppuccin/icons.json`. A theme-selectable set behind a lazy import also removes that from the bundle.
- **Opt-in scrollbars** (spec Layer 4). `globals.css:308-324` kills native scrollbars app-wide on purpose. Re-enabling must be scoped to themes that ask.
- **Unknown-key warn-and-drop.** `validateTheme.ts:47` hard-rejects unknown keys, so a theme file written against a newer build fails to load entirely on an older one. Worth doing before the namespace grows further, but it changes behavior for existing files and deserves its own change.
- **Dark-only themes in light mode.** `dracula`, `tokyo-night` and `kanagawa-dragon` have no light variant. `applyTheme` falls back to the dark one while `ThemeProvider.tsx:133` still sets `class="light"`, so all 80 `dark:` utilities take their light branch over dark surfaces. Task 2's `resolveThemeVars` is the right place to also return the variant actually used, but fixing it changes `resolvedMode` for 14 `useTheme` callers and is a behavior change, not a theming feature.

## Self-Review Notes

Checked against the spec:

- Spec Layer 1 tokens: Tasks 3 and 4. Spec Layer 2 surface classes: Tasks 6 and 7. Spec Layer 3 fonts: Task 8. Spec Phase 0 prerequisite: Task 1. Spec Phase 3 theme: Task 9. Spec Layer 4: deferred, listed above.
- Spec's testing section asked for `applyTheme` coverage (Task 2), `validateTheme` cases for new keys (Tasks 3 and 8), `listCustomThemes` dropping invalid entries (Task 1), and the zero-change invariant (Task 5).
- The spec proposed a single `surfaceWidth` token. This plan splits it into `panelWidth` and `slotWidth`, because the reference gives panels a three-ring bevel and slots a single inner ring, so they need separate scopes. `ThemeShape` in Task 3 reflects the split.
- The spec's `scale` typography key is dropped. Tailwind's `--text-*` are per-step variables, not a multiplier, so a single scale value cannot drive them without redefining every step. Not needed for the reference.
- The spec's both-variants test extension to all built-ins is deferred, because three built-ins are dark-only and fixing them is theme authoring, not infrastructure. Task 9 extends the assertion to `retro-pixel` only.
