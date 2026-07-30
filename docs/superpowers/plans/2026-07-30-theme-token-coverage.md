# Theme Token Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive editor syntax colours and semantic git/diagnostic status colours from the ANSI palette each theme already declares, so a theme colours the whole app rather than just its shell.

**Architecture:** Two pure functions map a theme's 16 ANSI colours onto 18 syntax roles and 7 status roles, then normalize each result's OKLab lightness until it clears a contrast floor against the app background. `applyTheme` writes them as `--syntax-*` and `--status-*` CSS variables. A single static CodeMirror theme per mode reads those variables through `var()`, so switching themes changes no extension identity and triggers no editor reconfiguration.

**Tech Stack:** TypeScript, React 19, Tailwind 4, CodeMirror 6 (`@uiw/codemirror-themes`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-theme-token-coverage-design.md`

## Global Constraints

- **No em-dash** anywhere: code, comments, commits, docs.
- **No emojis** anywhere.
- **No AI attribution in commits.** Never add `Co-Authored-By:` for an assistant, never a "Generated with" line. Match the repo's existing style: a single-line conventional-commit subject, no body, no trailers.
- **Comments:** default to none. If genuinely needed, 1-2 lines on *why*, never *what*.
- **Imports:** always `@/...` on the frontend, never relative across modules. Inside a single module directory, relative sibling imports (`./types`) are the existing convention and stay.
- **pnpm only**, never npm/npx/yarn.
- **A theme sets CSS variables and nothing else.** No theme may ship a selector or stylesheet. This is the security boundary stated in `THEME.md`.
- **Zero-change invariant:** a theme that sets none of the new keys must render exactly as before. Every new variable consumed in CSS uses `var(--x, <today's value>)`.
- Checks that must pass before any task is considered done: `pnpm lint`, `pnpm check-types`, `pnpm test`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/modules/theme/oklab.ts` | sRGB/OKLab conversion, WCAG contrast, `ensureContrast`. Pure colour math, no theme concepts. |
| `src/modules/theme/oklab.test.ts` | Round-trip and contrast-floor tests. |
| `src/modules/theme/derive.ts` | `syntaxFromAnsi`, `statusFromAnsi`, the slot maps, the role types. Pure. |
| `src/modules/theme/derive.test.ts` | Mapping, null-on-no-ansi, override-merge tests. |
| `src/modules/theme/resolveVariant.ts` | Shared `mode ?? dark ?? light` precedence that also reports which mode won. |
| `src/modules/theme/resolveVariant.test.ts` | Precedence tests. |
| `src/modules/theme/themes/syntaxLegibility.test.ts` | Contrast-floor regression guard across all built-ins. |

**Modified:**

| Path | Change |
|---|---|
| `src/modules/theme/types.ts` | Add `syntax?` and `status?` to `ThemeVariant`. |
| `src/modules/theme/applyTheme.ts` | Add `SYNTAX_VAR`/`STATUS_VAR`, call derivation from `resolveThemeVars`, use `resolveVariant`. |
| `src/modules/theme/validateTheme.ts` | Add `parseSyntax`/`parseStatus`; validate `SHAPE_COLOR_KEYS`. |
| `src/modules/theme/resolveEditorTheme.ts` | Return a discriminated resolution instead of a bare id. |
| `src/modules/theme/themeFiles.ts` | `starterTheme()` emits both variants plus ANSI. |
| `src/modules/theme/themes/terminalLegibility.test.ts` | Import the shared contrast helper instead of defining one. |
| `src/modules/editor/lib/cmThemes.ts` | Export `derivedLight`/`derivedDark` built from `var(--syntax-*)`. |
| `src/modules/editor/lib/useEditorThemeExt.ts` | Map the resolution union to an extension. |
| `src/styles/globals.css` | 7 `@theme inline` entries plus `:root`/`.dark` status defaults. |
| `src/styles/code-highlight.css` | 17 roles per block re-point at `var(--syntax-*, <today's value>)`. |
| `src/styles/tailwindTokens.test.ts` | Assert the new `@theme inline` entries. |
| 10 consumer files | Replace hardcoded palette classes with `text-status-*` / `bg-status-*`. |
| `THEME.md`, `TERRA.md` | Document the new tokens; correct the stale built-in list. |

---

## Task 1: Shared colour math

**Files:**
- Create: `src/modules/theme/oklab.ts`
- Test: `src/modules/theme/oklab.test.ts`
- Modify: `src/modules/theme/themes/terminalLegibility.test.ts:5-31` (delete the local helpers, import instead)

**Interfaces:**
- Consumes: nothing.
- Produces: `isHexColor(v: string | undefined): v is string`, `contrast(a: string, b: string): number`, `ensureContrast(color: string, bg: string, min: number): string`, `toOklab(hex: string): [number, number, number]`, `fromOklab(L: number, a: number, b: number): string`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/theme/oklab.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contrast, ensureContrast, fromOklab, isHexColor, toOklab } from "./oklab";

describe("isHexColor", () => {
  it("accepts 3 and 6 digit hex and rejects everything else", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#1f1f28")).toBe(true);
    expect(isHexColor("rgba(0,0,0,0.5)")).toBe(false);
    expect(isHexColor("oklch(0.5 0.1 200)")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

describe("contrast", () => {
  it("gives 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#3a94c5", "#3a94c5")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrast("#8da101", "#fdf6e3")).toBeCloseTo(
      contrast("#fdf6e3", "#8da101"),
      10,
    );
  });
});

describe("toOklab / fromOklab", () => {
  it("round-trips within one 8-bit step", () => {
    for (const hex of ["#000000", "#ffffff", "#8da101", "#df69ba", "#1f1f28"]) {
      const [L, a, b] = toOklab(hex);
      expect(fromOklab(L, a, b)).toBe(hex);
    }
  });
});

describe("ensureContrast", () => {
  it("returns the input untouched when the floor already holds", () => {
    expect(ensureContrast("#000000", "#ffffff", 4.5)).toBe("#000000");
  });

  it("reaches the floor against a light background by darkening", () => {
    const out = ensureContrast("#8da101", "#fdf6e3", 4.5);
    expect(contrast(out, "#fdf6e3")).toBeGreaterThanOrEqual(4.5);
  });

  it("reaches the floor against a dark background by lightening", () => {
    const out = ensureContrast("#2d4f67", "#1f1f28", 4.5);
    expect(contrast(out, "#1f1f28")).toBeGreaterThanOrEqual(4.5);
  });

  // The whole reason for moving lightness rather than blending toward the
  // foreground: blending desaturates into mud, this keeps the hue. Asserted as
  // hue angle and chroma retention rather than raw a/b, because a darker target
  // is often outside sRGB and the clamp acts as a gamut projection, which shifts
  // a and b while leaving hue intact.
  it("preserves hue and most of the chroma", () => {
    const hue = ([, a, b]: [number, number, number]) =>
      (Math.atan2(b, a) * 180) / Math.PI;
    const chroma = ([, a, b]: [number, number, number]) => Math.hypot(a, b);
    const before = toOklab("#8da101");
    const after = toOklab(ensureContrast("#8da101", "#fdf6e3", 4.5));
    expect(Math.abs(hue(after) - hue(before))).toBeLessThan(2);
    expect(chroma(after) / chroma(before)).toBeGreaterThan(0.75);
  });

  it("keeps everforest string vivid rather than grey", () => {
    // Regression pin on the measured outcome. Blending toward fg produced
    // #677658; lightness-only produces a still-saturated olive.
    const out = ensureContrast("#8da101", "#fdf6e3", 4.5);
    const [, a, b] = toOklab(out);
    expect(Math.hypot(a, b)).toBeGreaterThan(0.05);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/oklab.test.ts`
Expected: FAIL, cannot resolve `./oklab`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/theme/oklab.ts`:

```ts
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(v: string | undefined): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toByte(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = Number.parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function toOklab(hex: string): [number, number, number] {
  const [R, G, B] = channels(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab(L: number, A: number, B: number): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const h = (n: number) => toByte(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Raises a colour to a contrast floor by moving OKLab lightness only. Keeping
 * a and b fixed is what preserves hue and chroma: blending toward the theme
 * foreground also converges but desaturates the palette into grey.
 */
export function ensureContrast(color: string, bg: string, min: number): string {
  if (!isHexColor(color) || !isHexColor(bg)) return color;
  if (contrast(color, bg) >= min) return color;
  const [L0, A, B] = toOklab(color);
  const darken = luminance(bg) > 0.18;
  let lo = darken ? 0 : L0;
  let hi = darken ? L0 : 1;
  let best = fromOklab(darken ? 0 : 1, A, B);
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const cand = fromOklab(mid, A, B);
    if (contrast(cand, bg) >= min) {
      best = cand;
      if (darken) lo = mid;
      else hi = mid;
    } else if (darken) hi = mid;
    else lo = mid;
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/oklab.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Refactor terminalLegibility.test.ts onto the shared helper**

In `src/modules/theme/themes/terminalLegibility.test.ts`, delete lines 5-31 (the local `channel`, `luminance`, `contrast`) and add to the imports at the top:

```ts
import { contrast } from "../oklab";
```

Leave everything from `type Palette = ...` onward untouched.

- [ ] **Step 6: Run the theme suite to verify nothing regressed**

Run: `pnpm vitest run src/modules/theme`
Expected: PASS, with the terminal legibility test counts unchanged.

The extracted `contrast` is the same formula with one deliberate correction: the local
`channel()` used the sRGB breakpoint `0.03928`, and `oklab.ts` uses `0.04045`, the value
from IEC 61966-2-1. That only affects channel bytes around 10/255 and flips no assertion
in the suite, but it is a real difference, so do not describe the extraction as
byte-identical.

- [ ] **Step 7: Commit**

```bash
git add src/modules/theme/oklab.ts src/modules/theme/oklab.test.ts src/modules/theme/themes/terminalLegibility.test.ts
git commit -m "feat(theme): add shared oklab colour math with contrast normalization"
```

---

## Task 2: Variant resolution primitive

**Files:**
- Create: `src/modules/theme/resolveVariant.ts`
- Test: `src/modules/theme/resolveVariant.test.ts`

**Interfaces:**
- Consumes: `Theme`, `ThemeVariant`, `ThemeMode` from `./types`.
- Produces: `resolveVariant(theme: Theme, mode: ThemeMode): { variant: ThemeVariant; mode: ThemeMode } | null`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/theme/resolveVariant.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveVariant } from "./resolveVariant";
import type { Theme } from "./types";

function theme(variants: Theme["variants"]): Theme {
  return { id: "t", name: "T", variants };
}

describe("resolveVariant", () => {
  it("returns the exact mode when present, reporting that mode", () => {
    const light = { colors: { background: "#fff" } };
    const dark = { colors: { background: "#000" } };
    expect(resolveVariant(theme({ light, dark }), "light")).toEqual({
      variant: light,
      mode: "light",
    });
  });

  // A dark-only theme viewed in light mode shows its dark surfaces app-wide,
  // so consumers must be told the dark variant is the one that won.
  it("falls back to dark and reports dark, not the requested mode", () => {
    const dark = { colors: { background: "#000" } };
    expect(resolveVariant(theme({ dark }), "light")).toEqual({
      variant: dark,
      mode: "dark",
    });
  });

  it("falls back to light and reports light when only light exists", () => {
    const light = { colors: { background: "#fff" } };
    expect(resolveVariant(theme({ light }), "dark")).toEqual({
      variant: light,
      mode: "light",
    });
  });

  it("returns null when no variant exists", () => {
    expect(resolveVariant(theme({}), "dark")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/resolveVariant.test.ts`
Expected: FAIL, cannot resolve `./resolveVariant`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/theme/resolveVariant.ts`:

```ts
import type { Theme, ThemeMode, ThemeVariant } from "./types";

export type ResolvedVariant = { variant: ThemeVariant; mode: ThemeMode };

/**
 * Reports which variant supplies a theme's values and which mode it came from.
 * The second field matters because a single-variant theme renders its one
 * palette in both modes, so the editor must follow the variant, not the request.
 */
export function resolveVariant(
  theme: Theme,
  mode: ThemeMode,
): ResolvedVariant | null {
  const exact = theme.variants[mode];
  if (exact) return { variant: exact, mode };
  const dark = theme.variants.dark;
  if (dark) return { variant: dark, mode: "dark" };
  const light = theme.variants.light;
  if (light) return { variant: light, mode: "light" };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/resolveVariant.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/theme/resolveVariant.ts src/modules/theme/resolveVariant.test.ts
git commit -m "feat(theme): add resolveVariant reporting the winning variant mode"
```

---

## Task 3: Derivation

**Files:**
- Create: `src/modules/theme/derive.ts`
- Test: `src/modules/theme/derive.test.ts`
- Modify: `src/modules/theme/types.ts` (add `syntax?`, `status?` to `ThemeVariant`)

**Interfaces:**
- Consumes: `ensureContrast`, `isHexColor` from `./oklab`; `TerminalPalette`, `ThemeColors` from `./types`.
- Produces:
  - `SYNTAX_ROLES: readonly SyntaxRole[]` and `type SyntaxRole` (18 roles)
  - `STATUS_ROLES: readonly StatusRole[]` and `type StatusRole` (7 roles)
  - `type SyntaxPalette = Record<SyntaxRole, string>`, `type StatusTokens = Record<StatusRole, string>`
  - `syntaxFromAnsi(terminal, colors, override): SyntaxPalette | null`
  - `statusFromAnsi(terminal, colors, override): StatusTokens | null`

- [ ] **Step 1: Add the override keys to `types.ts`**

In `src/modules/theme/types.ts`, extend `ThemeVariant`:

```ts
export type ThemeVariant = {
  colors?: ThemeColors;
  terminal?: TerminalPalette;
  shape?: ThemeShape;
  type?: ThemeTypography;
  syntax?: Partial<Record<SyntaxRole, string>>;
  status?: Partial<Record<StatusRole, string>>;
};
```

Add the two role unions to `types.ts` so `ThemeVariant` can reference them without importing from `derive.ts` (which imports `types.ts`, so the dependency must point one way only). Place these blocks **above** `ThemeVariant` in the file, so a reader meets the roles before the type that uses them:

```ts
export const SYNTAX_ROLES = [
  "comment", "keyword", "string", "number", "constant", "func",
  "variable", "property", "gutterFg", "type", "operator", "tag",
  "tagBracket", "attr", "attrValue", "heading", "link", "invalid",
] as const;

export type SyntaxRole = (typeof SYNTAX_ROLES)[number];

export const STATUS_ROLES = [
  "added", "modified", "deleted", "renamed", "warning", "conflict", "ok",
] as const;

export type StatusRole = (typeof STATUS_ROLES)[number];

export type SyntaxPalette = Record<SyntaxRole, string>;
export type StatusTokens = Record<StatusRole, string>;
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/theme/derive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { statusFromAnsi, syntaxFromAnsi } from "./derive";
import { contrast, toOklab } from "./oklab";
import { SYNTAX_ROLES, STATUS_ROLES, type TerminalPalette } from "./types";

// Distinct, high-contrast slots so mapping assertions are unambiguous.
const ansi = [
  "#100000", "#ff0000", "#00ff00", "#ffff00",
  "#0000ff", "#ff00ff", "#00ffff", "#cccccc",
  "#888888", "#ff8080", "#80ff80", "#ffff80",
  "#8080ff", "#ff80ff", "#80ffff", "#ffffff",
] as unknown as NonNullable<TerminalPalette["ansi"]>;

const terminal: TerminalPalette = { background: "#000000", foreground: "#eeeeee", ansi };
const colors = { background: "#000000", foreground: "#eeeeee", card: "#111111" };

const hue = (hex: string) => {
  const [, a, b] = toOklab(hex);
  return (Math.atan2(b, a) * 180) / Math.PI;
};

// Pins a normalized value back to the slot it came from. An absolute hue
// tolerance is the wrong tool here: gamut clipping drifts slot 4 by 2 to 3
// degrees, so a 2 degree bound sits exactly on the boundary, while the nearest
// other slot is 18 degrees away. Relative distance has a 16 degree margin.
const nearestSlotByHue = (got: string | undefined): number => {
  const h = hue(got ?? "");
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  ansi.forEach((c, i) => {
    const d = Math.abs(h - hue(c));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
};

describe("syntaxFromAnsi", () => {
  it("returns null without an ansi palette", () => {
    expect(syntaxFromAnsi({ background: "#000" }, colors, undefined)).toBeNull();
    expect(syntaxFromAnsi(undefined, colors, undefined)).toBeNull();
  });

  it("returns a value for every role", () => {
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(p).not.toBeNull();
    for (const role of SYNTAX_ROLES) {
      expect(typeof p?.[role]).toBe("string");
    }
  });

  // Every slot-mapped role is pinned. A role left unasserted here could be
  // silently remapped to any other legible slot without a test failing, which is
  // the whole risk the mapping table carries for Tasks 4, 7, 8 and 9. The three
  // slot-4 roles (func, heading, renamed) are pinned by hue below instead,
  // because slot 4 fails its floor on this background and gets raised.
  it("maps roles to their documented ansi slots", () => {
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(p?.keyword).toBe("#ff00ff");
    expect(p?.string).toBe("#00ff00");
    expect(p?.number).toBe("#ffff00");
    expect(p?.property).toBe("#00ffff");
    expect(p?.type).toBe("#80ffff");
    expect(p?.constant).toBe("#ff80ff");
    expect(p?.attr).toBe("#ffff80");
    expect(p?.attrValue).toBe("#00ff00");
    expect(p?.link).toBe("#00ffff");
    expect(p?.tag).toBe("#ff0000");
    expect(p?.invalid).toBe("#ff8080");
  });

  it("maps comment, gutterFg and tagBracket all to bright black", () => {
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(p?.comment).toBe("#888888");
    expect(p?.gutterFg).toBe("#888888");
    expect(p?.tagBracket).toBe("#888888");
  });

  it("uses the terminal foreground for variable and operator", () => {
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(p?.variable).toBe("#eeeeee");
    expect(p?.operator).toBe("#eeeeee");
  });

  it("falls back to the colors foreground when the terminal omits one", () => {
    const p = syntaxFromAnsi({ ansi }, colors, undefined);
    expect(p?.variable).toBe("#eeeeee");
  });

  it("lets a partial override replace only its own keys", () => {
    const p = syntaxFromAnsi(terminal, colors, { keyword: "#abcdef" });
    expect(p?.keyword).toBe("#abcdef");
    expect(p?.string).toBe("#00ff00");
  });

  it("ignores an override key set to undefined", () => {
    const p = syntaxFromAnsi(terminal, colors, { keyword: undefined });
    expect(p?.keyword).toBe("#ff00ff");
  });

  // Slot 4 pure blue is 2.44:1 on this background and must be lifted, so it
  // cannot be asserted by value. The hue check is what pins these roles to slot
  // 4: remapping either to any already-legible slot would still pass a bare
  // contrast assertion.
  it.each(["func", "heading"] as const)(
    "raises %s from slot 4 to its floor while keeping its hue",
    (role) => {
      const p = syntaxFromAnsi(terminal, colors, undefined);
      expect(contrast(p?.[role] ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
      expect(p?.[role]).not.toBe("#0000ff");
      expect(nearestSlotByHue(p?.[role])).toBe(4);
    },
  );

  it("holds dim roles to 3:1 rather than 4.5:1", () => {
    const dim: TerminalPalette = {
      foreground: "#eeeeee",
      ansi: ansi.map((c, i) => (i === 8 ? "#3a3a3a" : c)) as never,
    };
    const p = syntaxFromAnsi(dim, colors, undefined);
    const ratio = contrast(p?.comment ?? "", "#000000");
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(4.5);
  });

  it("applies the floor to an override too", () => {
    const p = syntaxFromAnsi(terminal, colors, { keyword: "#050505" });
    expect(contrast(p?.keyword ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("passes a non-hex override through untouched", () => {
    const p = syntaxFromAnsi(terminal, colors, { keyword: "var(--x)" });
    expect(p?.keyword).toBe("var(--x)");
  });
});

describe("statusFromAnsi", () => {
  it("returns null without an ansi palette", () => {
    expect(statusFromAnsi({ background: "#000" }, colors, undefined)).toBeNull();
  });

  it("returns a value for every role", () => {
    const s = statusFromAnsi(terminal, colors, undefined);
    for (const role of STATUS_ROLES) {
      expect(typeof s?.[role]).toBe("string");
    }
  });

  it("maps roles to their documented ansi slots", () => {
    const s = statusFromAnsi(terminal, colors, undefined);
    expect(s?.added).toBe("#00ff00");
    expect(s?.modified).toBe("#ffff00");
    expect(s?.deleted).toBe("#ff0000");
    expect(s?.warning).toBe("#ffff00");
    expect(s?.conflict).toBe("#00ffff");
    expect(s?.ok).toBe("#00ff00");
  });

  // renamed is the one status role on slot 4, which fails its floor against both
  // surfaces here, so it is pinned by hue for the same reason func and heading are.
  it("raises renamed from slot 4 while keeping its hue", () => {
    const s = statusFromAnsi(terminal, colors, undefined);
    expect(s?.renamed).not.toBe("#0000ff");
    expect(nearestSlotByHue(s?.renamed)).toBe(4);
    expect(contrast(s?.renamed ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  // Opposite-polarity surfaces cannot both be cleared by one lightness, so the
  // canvas keeps its guarantee rather than being silently undone by the card pass.
  //
  // The card value matters. Against a black canvas the colour needs luminance
  // >= 0.175, and a near-white card still permits <= 0.183, so pure white leaves
  // an overlap band and the test cannot bite. #eeeeee permits only <= 0.151,
  // which is a genuine empty intersection.
  it("keeps the canvas floor when background and card have opposite polarity", () => {
    const s = statusFromAnsi(
      terminal,
      { background: "#000000", foreground: "#f5f5f5", card: "#eeeeee" },
      undefined,
    );
    for (const role of STATUS_ROLES) {
      expect(contrast(s?.[role] ?? "", "#000000")).toBeGreaterThanOrEqual(4.48);
    }
  });

  it("clears the floor against both background and card", () => {
    const s = statusFromAnsi(terminal, colors, undefined);
    for (const role of STATUS_ROLES) {
      expect(contrast(s?.[role] ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s?.[role] ?? "", "#111111")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("lets a partial override replace only its own keys", () => {
    const s = statusFromAnsi(terminal, colors, { modified: "#abcdef" });
    expect(s?.modified).toBe("#abcdef");
    expect(s?.added).toBe("#00ff00");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/derive.test.ts`
Expected: FAIL, cannot resolve `./derive`.

- [ ] **Step 4: Write the implementation**

Create `src/modules/theme/derive.ts`:

```ts
import { contrast, ensureContrast, isHexColor } from "./oklab";
import {
  STATUS_ROLES,
  SYNTAX_ROLES,
  type StatusRole,
  type StatusTokens,
  type SyntaxPalette,
  type SyntaxRole,
  type TerminalPalette,
  type ThemeColors,
} from "./types";

const SYNTAX_SLOT: Record<Exclude<SyntaxRole, "variable" | "operator">, number> =
  {
    comment: 8, keyword: 5, string: 2, number: 3, constant: 13,
    func: 4, property: 6, gutterFg: 8, type: 14, tag: 1,
    tagBracket: 8, attr: 11, attrValue: 2, heading: 4, link: 6, invalid: 9,
  };

const STATUS_SLOT: Record<StatusRole, number> = {
  added: 2, modified: 3, deleted: 1, renamed: 4,
  warning: 3, conflict: 6, ok: 2,
};

// Comment-weight roles are meant to recede, so they hold the 3:1 tier THEME.md
// already documents for slot 8 instead of the 4.5:1 body-text floor.
const DIM_ROLES: ReadonlySet<string> = new Set([
  "comment",
  "gutterFg",
  "tagBracket",
]);

function floorFor(role: string): number {
  return DIM_ROLES.has(role) ? 3 : 4.5;
}

function pick<T extends string>(
  override: Partial<Record<T, string>> | undefined,
  role: T,
): string | undefined {
  const v = override?.[role];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function syntaxFromAnsi(
  terminal: TerminalPalette | undefined,
  colors: ThemeColors | undefined,
  override: Partial<Record<SyntaxRole, string>> | undefined,
): SyntaxPalette | null {
  const ansi = terminal?.ansi;
  if (!ansi) return null;
  const fg = terminal?.foreground ?? colors?.foreground;
  const bg = colors?.background ?? terminal?.background;
  const out = {} as SyntaxPalette;
  for (const role of SYNTAX_ROLES) {
    const base =
      pick(override, role) ??
      (role === "variable" || role === "operator"
        ? fg
        : ansi[SYNTAX_SLOT[role as keyof typeof SYNTAX_SLOT]]);
    if (base === undefined) return null;
    out[role] =
      isHexColor(base) && isHexColor(bg)
        ? ensureContrast(base, bg, floorFor(role))
        : base;
  }
  return out;
}

export function statusFromAnsi(
  terminal: TerminalPalette | undefined,
  colors: ThemeColors | undefined,
  override: Partial<Record<StatusRole, string>> | undefined,
): StatusTokens | null {
  const ansi = terminal?.ansi;
  if (!ansi) return null;
  const bg = colors?.background ?? terminal?.background;
  const card = colors?.card;
  const out = {} as StatusTokens;
  for (const role of STATUS_ROLES) {
    const base = pick(override, role) ?? ansi[STATUS_SLOT[role]];
    if (base === undefined) return null;
    // Status text lands on the app canvas and on card surfaces both. When the
    // two surfaces sit on opposite sides of the luminance midpoint no single
    // lightness clears both, so the canvas wins as the larger surface.
    let value =
      isHexColor(base) && isHexColor(bg)
        ? ensureContrast(base, bg, 4.5)
        : base;
    if (isHexColor(value) && isHexColor(card)) {
      const withCard = ensureContrast(value, card, 4.5);
      if (!isHexColor(bg) || contrast(withCard, bg) >= 4.5) value = withCard;
    }
    out[role] = value;
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/derive.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 6: Run typecheck**

Run: `pnpm check-types`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/theme/derive.ts src/modules/theme/derive.test.ts src/modules/theme/types.ts
git commit -m "feat(theme): derive syntax and status palettes from the ansi palette"
```

---

## Task 4: Write the new variables from applyTheme

**Files:**
- Modify: `src/modules/theme/applyTheme.ts:1-104`
- Test: `src/modules/theme/applyTheme.test.ts` (extend)

**Interfaces:**
- Consumes: `syntaxFromAnsi`, `statusFromAnsi` from `./derive`; `resolveVariant` from `./resolveVariant`.
- Produces: `--syntax-<kebab-role>` and `--status-<role>` entries in `resolveThemeVars` output and in `ALL_VARS`.

CSS variable names are the role in kebab-case: `gutterFg` becomes `--syntax-gutter-fg`, `tagBracket` becomes `--syntax-tag-bracket`, `attrValue` becomes `--syntax-attr-value`. All status roles are single words, so `--status-added` and so on.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("resolveThemeVars", ...)` block in `src/modules/theme/applyTheme.test.ts`:

```ts
  it("derives syntax and status variables from an ansi palette", () => {
    const ansi = [
      "#100000", "#ff0000", "#00ff00", "#ffff00",
      "#0000ff", "#ff00ff", "#00ffff", "#cccccc",
      "#888888", "#ff8080", "#80ff80", "#ffff80",
      "#8080ff", "#ff80ff", "#80ffff", "#ffffff",
    ];
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            colors: { background: "#000000", foreground: "#eeeeee" },
            terminal: {
              background: "#000000",
              foreground: "#eeeeee",
              ansi: ansi as unknown as never,
            },
          },
        },
      }),
      "dark",
    );
    const names = vars?.map(([n]) => n) ?? [];
    expect(names).toContain("--syntax-keyword");
    expect(names).toContain("--syntax-gutter-fg");
    expect(names).toContain("--syntax-tag-bracket");
    expect(names).toContain("--syntax-attr-value");
    expect(names).toContain("--status-added");
    expect(names).toContain("--status-conflict");
    expect(names).toContain("--status-ok");
  });

  it("emits no syntax or status variables without an ansi palette", () => {
    const vars = resolveThemeVars(
      theme({
        variants: { dark: { colors: { background: "#000" }, terminal: { background: "#000" } } },
      }),
      "dark",
    );
    const names = vars?.map(([n]) => n) ?? [];
    expect(names.some((n) => n.startsWith("--syntax-"))).toBe(false);
    expect(names.some((n) => n.startsWith("--status-"))).toBe(false);
  });

  it("keeps every derived name clearable through ALL_VARS", () => {
    const ansi = Array.from({ length: 16 }, (_, i) => `#${(i * 17).toString(16).padStart(2, "0").repeat(3)}`);
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            colors: { background: "#000000", foreground: "#ffffff", card: "#111111" },
            terminal: { foreground: "#ffffff", ansi: ansi as unknown as never },
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
Expected: FAIL, `--syntax-keyword` not found in the emitted names.

- [ ] **Step 3: Add the variable maps**

In `src/modules/theme/applyTheme.ts`, add after the existing `TYPE_VAR` block:

```ts
const SYNTAX_VAR: Record<SyntaxRole, string> = {
  comment: "--syntax-comment",
  keyword: "--syntax-keyword",
  string: "--syntax-string",
  number: "--syntax-number",
  constant: "--syntax-constant",
  func: "--syntax-func",
  variable: "--syntax-variable",
  property: "--syntax-property",
  gutterFg: "--syntax-gutter-fg",
  type: "--syntax-type",
  operator: "--syntax-operator",
  tag: "--syntax-tag",
  tagBracket: "--syntax-tag-bracket",
  attr: "--syntax-attr",
  attrValue: "--syntax-attr-value",
  heading: "--syntax-heading",
  link: "--syntax-link",
  invalid: "--syntax-invalid",
};

const STATUS_VAR: Record<StatusRole, string> = {
  added: "--status-added",
  modified: "--status-modified",
  deleted: "--status-deleted",
  renamed: "--status-renamed",
  warning: "--status-warning",
  conflict: "--status-conflict",
  ok: "--status-ok",
};
```

Extend the imports at the top of the file:

```ts
import { statusFromAnsi, syntaxFromAnsi } from "./derive";
import { resolveVariant } from "./resolveVariant";
import type {
  StatusRole,
  SyntaxRole,
  Theme,
  ThemeColors,
  ThemeMode,
  TerminalPalette,
  ThemeShape,
  ThemeTypography,
} from "./types";
```

Add the two new map groups to `ALL_VARS`:

```ts
export const ALL_VARS: readonly string[] = [
  ...Object.values(COLOR_VAR),
  ...Object.values(SHAPE_VAR),
  ...Object.values(TYPE_VAR),
  ...Object.values(SYNTAX_VAR),
  ...Object.values(STATUS_VAR),
  "--terminal-background",
  "--terminal-foreground",
  "--terminal-cursor",
  "--terminal-cursor-accent",
  "--terminal-selection",
  ...ANSI_VARS,
];
```

- [ ] **Step 4: Call the derivation from resolveThemeVars**

Replace the body of `resolveThemeVars` in `src/modules/theme/applyTheme.ts:94-104` with:

```ts
export function resolveThemeVars(theme: Theme, mode: ThemeMode): ThemeVar[] | null {
  const resolved = resolveVariant(theme, mode);
  if (!resolved) return null;
  const { variant } = resolved;
  const out: ThemeVar[] = [];
  if (variant.colors) collectColors(out, variant.colors);
  if (variant.terminal) collectTerminal(out, variant.terminal);
  if (variant.shape) collectShape(out, variant.shape);
  if (variant.type) collectType(out, variant.type);
  const syntax = syntaxFromAnsi(variant.terminal, variant.colors, variant.syntax);
  if (syntax) {
    for (const role of Object.keys(syntax) as SyntaxRole[]) {
      out.push([SYNTAX_VAR[role], syntax[role]]);
    }
  }
  const status = statusFromAnsi(variant.terminal, variant.colors, variant.status);
  if (status) {
    for (const role of Object.keys(status) as StatusRole[]) {
      out.push([STATUS_VAR[role], status[role]]);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/modules/theme`
Expected: PASS. Note two pre-existing tests now exercise the new code and must stay green:
- `"omits keys the variant does not set"` passes because its variant has no `terminal`, so derivation returns `null`.
- `"emits only names that ALL_VARS can clear"` passes because the new maps are in `ALL_VARS`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/theme/applyTheme.ts src/modules/theme/applyTheme.test.ts
git commit -m "feat(theme): write derived syntax and status css variables"
```

---

## Task 5: Validation for user themes

**Files:**
- Modify: `src/modules/theme/validateTheme.ts:37-50, 123-143, 176-187`
- Test: `src/modules/theme/validateTheme.test.ts` (extend)

**Interfaces:**
- Consumes: `SYNTAX_ROLES`, `STATUS_ROLES` from `./types`.
- Produces: `variants.<mode>.syntax` and `variants.<mode>.status` accepted on validated themes; `SHAPE_COLOR_KEYS` now rejected when malformed.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/theme/validateTheme.test.ts`:

```ts
describe("syntax and status overrides", () => {
  // The id must clear ID_RE, which requires 2 to 64 characters. A single-letter
  // id fails validation first and would mask what these cases actually assert.
  function withVariant(variant: unknown) {
    return { id: "ok-id", name: "T", variants: { dark: variant } };
  }

  it("accepts a partial syntax override", () => {
    const r = validateTheme(withVariant({ syntax: { keyword: "#abcdef" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme.variants.dark?.syntax?.keyword).toBe("#abcdef");
  });

  it("accepts a partial status override", () => {
    const r = validateTheme(withVariant({ status: { modified: "#abcdef" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme.variants.dark?.status?.modified).toBe("#abcdef");
  });

  it("rejects an unknown syntax key", () => {
    const r = validateTheme(withVariant({ syntax: { notARole: "#abcdef" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("notARole");
  });

  it("rejects an unknown status key", () => {
    const r = validateTheme(withVariant({ status: { info: "#abcdef" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("info");
  });

  it("rejects a non-string syntax value", () => {
    const r = validateTheme(withVariant({ syntax: { keyword: 5 } }));
    expect(r.ok).toBe(false);
  });
});

describe("shape colour validation", () => {
  function withShape(shape: unknown) {
    return { id: "ok-id", name: "T", variants: { dark: { shape } } };
  }

  it.each(["#abc", "#aabbcc", "transparent", "rgb(1,2,3)", "rgba(1,2,3,0.5)", "oklch(0.5 0.1 200)"])(
    "accepts %s",
    (value) => {
      expect(validateTheme(withShape({ bevelOuter: value })).ok).toBe(true);
    },
  );

  // These land inside a composed box-shadow, so a breakout would silently
  // kill all three bevel rings and the lift at once.
  it.each(["red; color: blue", "url(x)", "}", "#12", "notacolour"])(
    "rejects %s",
    (value) => {
      expect(validateTheme(withShape({ bevelOuter: value })).ok).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/validateTheme.test.ts`
Expected: FAIL. The unknown-syntax-key cases fail because `parseVariant` ignores the field, and the shape-colour rejections fail because nothing validates them.

- [ ] **Step 3: Add the colour form check and the two parsers**

In `src/modules/theme/validateTheme.ts`, add near `LENGTH_RE`:

```ts
// Shape colours compose into a shared box-shadow, so the value is matched
// rather than passed through: one bad token takes out every ring and the lift.
const COLOR_RE =
  /^(transparent|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([^;{}()]*\))$/;
```

Inside `parseShape`, replace the length-only check with:

```ts
    if (isLength && !LENGTH_RE.test(v)) {
      return `${path}.${k} must be a CSS length such as 4px or 0`;
    }
    if (isColor && !COLOR_RE.test(v)) {
      return `${path}.${k} must be a colour such as #rrggbb, transparent, or oklch(...)`;
    }
```

Add the two parsers before `parseVariant`:

```ts
function parseRoleMap<T extends string>(
  raw: unknown,
  path: string,
  roles: readonly T[],
  label: string,
): Partial<Record<T, string>> | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return `${path} must be an object`;
  const out: Partial<Record<T, string>> = {};
  for (const k of Object.keys(raw)) {
    if (!(roles as readonly string[]).includes(k)) {
      return `${path}.${k} is not a recognized ${label} role`;
    }
    const v = raw[k];
    if (!isStr(v) || v.length === 0) {
      return `${path}.${k} must be a non-empty string`;
    }
    out[k as T] = v;
  }
  return out;
}
```

Extend `parseVariant` to thread both through:

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
  const syntax = parseRoleMap(raw.syntax, `${path}.syntax`, SYNTAX_ROLES, "syntax");
  if (typeof syntax === "string") return syntax;
  const status = parseRoleMap(raw.status, `${path}.status`, STATUS_ROLES, "status");
  if (typeof status === "string") return status;
  return { colors, terminal, shape, type, syntax, status };
}
```

Add `SYNTAX_ROLES` and `STATUS_ROLES` to the existing `./types` import list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/modules/theme/validateTheme.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm no built-in regressed**

Run: `pnpm vitest run src/modules/theme`
Expected: PASS. Built-ins skip validation, but `nothing.ts` and `stardew.ts` use `rgba(...)` for `terminal.selection`, which `parseTerminal` still passes through untouched. Only `SHAPE_COLOR_KEYS` gained a check.

- [ ] **Step 6: Commit**

```bash
git add src/modules/theme/validateTheme.ts src/modules/theme/validateTheme.test.ts
git commit -m "feat(theme): validate syntax, status and shape colour overrides"
```

---

## Task 6: Status tokens in Tailwind

**Files:**
- Modify: `src/styles/globals.css:11-54` (`@theme inline`), `:65-98` (`:root`), `:100-132` (`.dark`)
- Test: `src/styles/tailwindTokens.test.ts` (extend)

**Interfaces:**
- Consumes: `--status-*` variables written by Task 4.
- Produces: `text-status-*`, `bg-status-*`, `border-status-*` utilities for the 7 roles, with `:root`/`.dark` defaults so unthemed rendering is unchanged.

Default values, copied verbatim from `node_modules/tailwindcss/theme.css`:

| Token | light (`:root`) | dark (`.dark`) |
|---|---|---|
| `--status-added` | `oklch(50.8% 0.118 165.612)` (emerald-700) | `oklch(76.5% 0.177 163.223)` (emerald-400) |
| `--status-modified` | `oklch(55.5% 0.163 48.998)` (amber-700) | `oklch(87.9% 0.169 91.605)` (amber-300) |
| `--status-deleted` | `oklch(51.4% 0.222 16.935)` (rose-700) | `oklch(71.2% 0.194 13.428)` (rose-400) |
| `--status-renamed` | `oklch(50% 0.134 242.749)` (sky-700) | `oklch(82.8% 0.111 230.318)` (sky-300) |
| `--status-warning` | `oklch(55.5% 0.163 48.998)` (amber-700) | `oklch(82.8% 0.189 84.429)` (amber-400) |
| `--status-conflict` | `oklch(51.1% 0.096 186.391)` (teal-700) | `oklch(77.7% 0.152 181.912)` (teal-400) |
| `--status-ok` | `oklch(69.6% 0.17 162.48)` (emerald-500) | `oklch(69.6% 0.17 162.48)` (emerald-500) |

- [ ] **Step 1: Write the failing test**

Append to `src/styles/tailwindTokens.test.ts`:

```ts
const STATUS_ROLE_NAMES = [
  "added", "modified", "deleted", "renamed", "warning", "conflict", "ok",
] as const;

describe("status tokens", () => {
  it("wires every role through @theme inline", () => {
    for (const role of STATUS_ROLE_NAMES) {
      expect(GLOBALS).toContain(
        `--color-status-${role}: var(--status-${role});`,
      );
    }
  });

  it("declares a light and a dark default for every role", () => {
    const darkStart = GLOBALS.indexOf(".dark {");
    const root = GLOBALS.slice(GLOBALS.indexOf(":root {"), darkStart);
    // Both slices must be bounded. Left open, the dark slice runs to EOF, and
    // four more :root blocks follow it, so a default misplaced outside .dark
    // would still be found and this test would pass while dark mode broke.
    const dark = GLOBALS.slice(darkStart, GLOBALS.indexOf("}", darkStart) + 1);
    for (const role of STATUS_ROLE_NAMES) {
      expect(root).toContain(`--status-${role}:`);
      expect(dark).toContain(`--status-${role}:`);
    }
  });

  it("compiles text and bg utilities for every role", async () => {
    const inline = GLOBALS.slice(
      GLOBALS.indexOf("@theme inline"),
      GLOBALS.indexOf("@utility border"),
    );
    const css = await build(
      `@import "tailwindcss";\n${inline}`,
      STATUS_ROLE_NAMES.flatMap((r) => [`text-status-${r}`, `bg-status-${r}`]),
    );
    for (const role of STATUS_ROLE_NAMES) {
      expect(css).toContain(`var(--status-${role})`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/styles/tailwindTokens.test.ts`
Expected: FAIL, `--color-status-added` not present.

- [ ] **Step 3: Add the entries to globals.css**

Inside the `@theme inline` block in `src/styles/globals.css`, add after `--spacing`:

```css
    --color-status-added: var(--status-added);
    --color-status-modified: var(--status-modified);
    --color-status-deleted: var(--status-deleted);
    --color-status-renamed: var(--status-renamed);
    --color-status-warning: var(--status-warning);
    --color-status-conflict: var(--status-conflict);
    --color-status-ok: var(--status-ok);
```

Add to the `:root` block, after `--sidebar-ring`:

```css
    --status-added: oklch(50.8% 0.118 165.612);
    --status-modified: oklch(55.5% 0.163 48.998);
    --status-deleted: oklch(51.4% 0.222 16.935);
    --status-renamed: oklch(50% 0.134 242.749);
    --status-warning: oklch(55.5% 0.163 48.998);
    --status-conflict: oklch(51.1% 0.096 186.391);
    --status-ok: oklch(69.6% 0.17 162.48);
```

Add to the `.dark` block, after `--sidebar-ring`:

```css
    --status-added: oklch(76.5% 0.177 163.223);
    --status-modified: oklch(87.9% 0.169 91.605);
    --status-deleted: oklch(71.2% 0.194 13.428);
    --status-renamed: oklch(82.8% 0.111 230.318);
    --status-warning: oklch(82.8% 0.189 84.429);
    --status-conflict: oklch(77.7% 0.152 181.912);
    --status-ok: oklch(69.6% 0.17 162.48);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/styles/tailwindTokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css src/styles/tailwindTokens.test.ts
git commit -m "feat(theme): add semantic status colour tokens"
```

---

## Task 7: Point the markdown token palette at the theme

**Files:**
- Modify: `src/styles/code-highlight.css:5-43`
- Test: `src/styles/codeHighlightTokens.test.ts` (create)

**Interfaces:**
- Consumes: `--syntax-*` from Task 4.
- Produces: nothing new; `--tok-*` keeps its names so the 130 lines of selectors below are untouched.

Role mapping, applied identically in both the `:root` and `:is(.dark *)` blocks:

| `--tok-*` | source | `--tok-*` | source |
|---|---|---|---|
| `keyword` | `--syntax-keyword` | `tag` | `--syntax-tag` |
| `name` | `--syntax-variable` | `attr` | `--syntax-attr` |
| `type` | `--syntax-type` | `punctuation` | `--syntax-operator` |
| `property` | `--syntax-property` | `heading` | `--syntax-heading` |
| `operator` | `--syntax-operator` | `link` | `--syntax-link` |
| `comment` | `--syntax-comment` | `invalid` | `--syntax-invalid` |
| `string` | `--syntax-string` | `bool` | `--syntax-constant` |
| `number` | `--syntax-number` | `regexp` | `--syntax-string` |
| `meta` | `--syntax-comment` | | |

- [ ] **Step 1: Write the failing test**

Create `src/styles/codeHighlightTokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "code-highlight.css"),
  "utf8",
);

const DECLS = CSS.split("\n").filter((l) => /^\s+--tok-/.test(l));

describe("code highlight tokens", () => {
  it("keeps both a light and a dark declaration for every role", () => {
    expect(DECLS).toHaveLength(34);
  });

  it("routes every declaration through a syntax variable", () => {
    for (const line of DECLS) {
      expect(line).toMatch(/--tok-[a-z]+:\s*var\(--syntax-[a-z-]+,/);
    }
  });

  // The fallback is what preserves the zero-change invariant: a theme that
  // derives nothing must render the exact oklch values shipped today.
  it("keeps an oklch fallback on every declaration", () => {
    for (const line of DECLS) {
      expect(line).toMatch(/,\s*oklch\([^)]*\)\)\s*;$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/styles/codeHighlightTokens.test.ts`
Expected: FAIL on the second assertion, declarations are bare `oklch(...)`.

- [ ] **Step 3: Rewrite the two declaration blocks**

In `src/styles/code-highlight.css`, wrap each existing value. The `:root` block becomes:

```css
:root {
  --tok-keyword: var(--syntax-keyword, oklch(0.45 0.15 270));
  --tok-name: var(--syntax-variable, oklch(0.32 0.05 250));
  --tok-type: var(--syntax-type, oklch(0.55 0.13 200));
  --tok-property: var(--syntax-property, oklch(0.42 0.13 25));
  --tok-operator: var(--syntax-operator, oklch(0.55 0.04 250));
  --tok-comment: var(--syntax-comment, oklch(0.55 0.02 250));
  --tok-string: var(--syntax-string, oklch(0.48 0.13 150));
  --tok-number: var(--syntax-number, oklch(0.52 0.14 50));
  --tok-bool: var(--syntax-constant, oklch(0.52 0.15 30));
  --tok-regexp: var(--syntax-string, oklch(0.5 0.15 0));
  --tok-meta: var(--syntax-comment, oklch(0.5 0.1 290));
  --tok-tag: var(--syntax-tag, oklch(0.45 0.16 25));
  --tok-attr: var(--syntax-attr, oklch(0.5 0.14 70));
  --tok-punctuation: var(--syntax-operator, oklch(0.5 0.02 250));
  --tok-heading: var(--syntax-heading, oklch(0.42 0.13 25));
  --tok-link: var(--syntax-link, oklch(0.5 0.15 240));
  --tok-invalid: var(--syntax-invalid, oklch(0.55 0.22 25));
}
```

And the `:is(.dark *)` block:

```css
:is(.dark *) {
  --tok-keyword: var(--syntax-keyword, oklch(0.78 0.13 305));
  --tok-name: var(--syntax-variable, oklch(0.92 0.01 250));
  --tok-type: var(--syntax-type, oklch(0.83 0.11 200));
  --tok-property: var(--syntax-property, oklch(0.82 0.1 25));
  --tok-operator: var(--syntax-operator, oklch(0.72 0.03 250));
  --tok-comment: var(--syntax-comment, oklch(0.6 0.02 250));
  --tok-string: var(--syntax-string, oklch(0.82 0.12 145));
  --tok-number: var(--syntax-number, oklch(0.82 0.13 60));
  --tok-bool: var(--syntax-constant, oklch(0.82 0.14 30));
  --tok-regexp: var(--syntax-string, oklch(0.8 0.14 10));
  --tok-meta: var(--syntax-comment, oklch(0.78 0.1 290));
  --tok-tag: var(--syntax-tag, oklch(0.78 0.14 25));
  --tok-attr: var(--syntax-attr, oklch(0.83 0.12 70));
  --tok-punctuation: var(--syntax-operator, oklch(0.72 0.02 250));
  --tok-heading: var(--syntax-heading, oklch(0.82 0.1 25));
  --tok-link: var(--syntax-link, oklch(0.78 0.13 240));
  --tok-invalid: var(--syntax-invalid, oklch(0.7 0.22 25));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/styles/codeHighlightTokens.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/styles/code-highlight.css src/styles/codeHighlightTokens.test.ts
git commit -m "feat(theme): drive markdown code tokens from the syntax palette"
```

---

## Task 8: Variable-driven CodeMirror theme and the resolution union

**Files:**
- Modify: `src/modules/editor/lib/cmThemes.ts:36-121` (add exports after `build`)
- Modify: `src/modules/theme/resolveEditorTheme.ts` (whole file)
- Modify: `src/modules/theme/resolveEditorTheme.test.ts` (whole file)
- Modify: `src/modules/editor/lib/useEditorThemeExt.ts:8-15`
- Modify: `src/modules/theme/index.ts` (export the new symbol if `resolveEditorThemeId` is re-exported there)

**Interfaces:**
- Consumes: `resolveVariant` from Task 2, `syntaxFromAnsi` from Task 3.
- Produces:
  - `derivedLight: Extension`, `derivedDark: Extension` from `cmThemes.ts`
  - `type EditorThemeResolution = { kind: "derived"; mode: "light" | "dark" } | { kind: "preset"; id: EditorThemeId }`
  - `resolveEditorTheme(pref, themeId, customThemes, mode): EditorThemeResolution`

- [ ] **Step 1: Add the derived extensions**

In `src/modules/editor/lib/cmThemes.ts`, add immediately after the `build` function:

```ts
function varPalette(mode: "light" | "dark"): Palette {
  return {
    mode,
    // buildSharedExtensions() owns the editor surface, so these stay inert.
    bg: "transparent",
    caret: "transparent",
    selection: "transparent",
    lineHighlight: "transparent",
    fg: "var(--foreground)",
    gutterFg: "var(--syntax-gutter-fg)",
    comment: "var(--syntax-comment)",
    keyword: "var(--syntax-keyword)",
    string: "var(--syntax-string)",
    number: "var(--syntax-number)",
    constant: "var(--syntax-constant)",
    func: "var(--syntax-func)",
    variable: "var(--syntax-variable)",
    property: "var(--syntax-property)",
    type: "var(--syntax-type)",
    operator: "var(--syntax-operator)",
    tag: "var(--syntax-tag)",
    tagBracket: "var(--syntax-tag-bracket)",
    attr: "var(--syntax-attr)",
    attrValue: "var(--syntax-attr-value)",
    heading: "var(--syntax-heading)",
    link: "var(--syntax-link)",
    invalid: "var(--syntax-invalid)",
  };
}

// Built once. A theme switch only changes the variables these read, so the
// extension identity is stable and no mounted editor reconfigures.
export const derivedLight = build(varPalette("light"));
export const derivedDark = build(varPalette("dark"));
```

- [ ] **Step 2: Write the failing test**

Replace `src/modules/theme/resolveEditorTheme.test.ts` entirely:

```ts
import { describe, expect, it } from "vitest";
import { resolveEditorTheme } from "./resolveEditorTheme";
import type { Theme } from "./types";

const ansi = Array.from({ length: 16 }, (_, i) =>
  `#${(i * 16).toString(16).padStart(2, "0").repeat(3)}`,
) as unknown as never;

const noAnsi: Theme = {
  id: "no-ansi",
  name: "No Ansi",
  editorTheme: { dark: "dracula", light: "github-light" },
  variants: { dark: {}, light: {} },
};

const withAnsi: Theme = {
  id: "with-ansi",
  name: "With Ansi",
  editorTheme: { dark: "dracula", light: "github-light" },
  variants: {
    dark: { colors: { background: "#000000", foreground: "#ffffff" }, terminal: { ansi } },
    light: { colors: { background: "#ffffff", foreground: "#000000" }, terminal: { ansi } },
  },
};

const darkOnly: Theme = {
  id: "dark-only",
  name: "Dark Only",
  variants: {
    dark: { colors: { background: "#000000", foreground: "#ffffff" }, terminal: { ansi } },
  },
};

// No ansi palette and only a dark pairing, so the cross-mode fallback inside the
// editorTheme chain is the only thing that can resolve light mode. Without a
// theme shaped like this, deleting that fallback passes every other test.
const asymmetricPairing: Theme = {
  id: "asymmetric-pairing",
  name: "Asymmetric Pairing",
  editorTheme: { dark: "dracula" },
  variants: { dark: {}, light: {} },
};

describe("resolveEditorTheme", () => {
  it("returns an explicit pref as a preset, ignoring the app theme", () => {
    expect(resolveEditorTheme("nord", "with-ansi", [withAnsi], "dark")).toEqual({
      kind: "preset",
      id: "nord",
    });
  });

  it("derives when the theme has an ansi palette, outranking editorTheme", () => {
    expect(resolveEditorTheme("auto", "with-ansi", [withAnsi], "dark")).toEqual({
      kind: "derived",
      mode: "dark",
    });
    expect(resolveEditorTheme("auto", "with-ansi", [withAnsi], "light")).toEqual({
      kind: "derived",
      mode: "light",
    });
  });

  // The variant that supplied the colours decides the frame, so a dark-only
  // theme in light mode must not mount a light editor over dark syntax.
  it("reports the winning variant mode for a single-variant theme", () => {
    expect(resolveEditorTheme("auto", "dark-only", [darkOnly], "light")).toEqual({
      kind: "derived",
      mode: "dark",
    });
  });

  // Pins the cross-mode fallback inside the pairing chain. A mutant reducing it
  // to `theme.editorTheme?.[mode]` passes every other test in this file.
  it("falls back across modes within the editorTheme pairing", () => {
    expect(
      resolveEditorTheme("auto", "asymmetric-pairing", [asymmetricPairing], "light"),
    ).toEqual({ kind: "preset", id: "dracula" });
  });

  it("falls through to the editorTheme pairing without an ansi palette", () => {
    expect(resolveEditorTheme("auto", "no-ansi", [noAnsi], "dark")).toEqual({
      kind: "preset",
      id: "dracula",
    });
    expect(resolveEditorTheme("auto", "no-ansi", [noAnsi], "light")).toEqual({
      kind: "preset",
      id: "github-light",
    });
  });

  it("resolves terra-default to its atomone pairing", () => {
    expect(resolveEditorTheme("auto", "terra-default", [], "dark")).toEqual({
      kind: "preset",
      id: "atomone",
    });
  });

  it("uses the default theme pairing for an unknown app theme", () => {
    expect(resolveEditorTheme("auto", "does-not-exist", [], "dark")).toEqual({
      kind: "preset",
      id: "atomone",
    });
  });

  it("falls back to a neutral preset when the pairing is invalid", () => {
    const bad: Theme = {
      id: "bad",
      name: "Bad",
      editorTheme: { dark: "not-a-real-theme" },
      variants: { dark: {} },
    };
    expect(resolveEditorTheme("auto", "bad", [bad], "dark")).toEqual({
      kind: "preset",
      id: "atomone",
    });
    expect(resolveEditorTheme("auto", "bad", [bad], "light")).toEqual({
      kind: "preset",
      id: "github-light",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/resolveEditorTheme.test.ts`
Expected: FAIL, `resolveEditorTheme` is not exported.

- [ ] **Step 4: Rewrite resolveEditorTheme.ts**

Replace `src/modules/theme/resolveEditorTheme.ts` entirely:

```ts
import {
  EDITOR_THEME_AUTO,
  isEditorThemeId,
  type EditorThemeId,
  type EditorThemePref,
} from "@/modules/settings/store";
import { syntaxFromAnsi } from "./derive";
import { resolveVariant } from "./resolveVariant";
import { getBuiltinTheme, getDefaultTheme } from "./themes";
import type { Theme } from "./types";

const FALLBACK: Record<"light" | "dark", EditorThemeId> = {
  light: "github-light",
  dark: "atomone",
};

export type EditorThemeResolution =
  | { kind: "derived"; mode: "light" | "dark" }
  | { kind: "preset"; id: EditorThemeId };

/**
 * Resolves what the editor should render. In "auto" a theme that can derive a
 * syntax palette from its own ansi colours does so, which is what makes the
 * editor match the theme instead of a hand-picked third-party pairing.
 */
export function resolveEditorTheme(
  pref: EditorThemePref,
  themeId: string,
  customThemes: Theme[],
  mode: "light" | "dark",
): EditorThemeResolution {
  if (pref !== EDITOR_THEME_AUTO) return { kind: "preset", id: pref };
  const theme =
    customThemes.find((t) => t.id === themeId) ??
    getBuiltinTheme(themeId) ??
    getDefaultTheme();
  const resolved = resolveVariant(theme, mode);
  if (resolved) {
    const { variant } = resolved;
    if (syntaxFromAnsi(variant.terminal, variant.colors, variant.syntax)) {
      return { kind: "derived", mode: resolved.mode };
    }
  }
  const mapped =
    theme.editorTheme?.[mode] ??
    theme.editorTheme?.dark ??
    theme.editorTheme?.light;
  return {
    kind: "preset",
    id: isEditorThemeId(mapped) ? mapped : FALLBACK[mode],
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/resolveEditorTheme.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Wire the hook**

Replace the body of `src/modules/editor/lib/useEditorThemeExt.ts`:

```ts
import { usePreferencesStore } from "@/modules/settings/preferences";
import { resolveEditorTheme, useTheme } from "@/modules/theme";
import type { Extension } from "@codemirror/state";
import { useMemo } from "react";
import { derivedDark, derivedLight } from "./cmThemes";
import { EDITOR_THEME_EXT } from "./themes";

/** Resolves the active CodeMirror theme extension, honoring the "auto" pairing. */
export function useEditorThemeExt(): Extension {
  const pref = usePreferencesStore((s) => s.editorTheme);
  const { themeId, customThemes, resolvedMode } = useTheme();
  return useMemo(() => {
    const r = resolveEditorTheme(pref, themeId, customThemes, resolvedMode);
    if (r.kind === "derived") {
      return r.mode === "dark" ? derivedDark : derivedLight;
    }
    return EDITOR_THEME_EXT[r.id] ?? EDITOR_THEME_EXT.atomone;
  }, [pref, themeId, customThemes, resolvedMode]);
}
```

- [ ] **Step 7: Update the barrel**

`useEditorThemeExt.ts` (done in Step 6) and the barrel are the only two non-test callers. In `src/modules/theme/index.ts` replace line 4:

```ts
export {
  resolveEditorTheme,
  type EditorThemeResolution,
} from "./resolveEditorTheme";
```

Then confirm nothing else references the old name:

Run: `grep -rn "resolveEditorThemeId" src/`
Expected: no output.

- [ ] **Step 8: Run the full check set**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/editor/lib/cmThemes.ts src/modules/editor/lib/useEditorThemeExt.ts src/modules/theme/resolveEditorTheme.ts src/modules/theme/resolveEditorTheme.test.ts src/modules/theme/index.ts
git commit -m "feat(editor): render derived syntax through variable-driven codemirror themes"
```

---

## Task 9: Legibility regression guard

**Files:**
- Create: `src/modules/theme/themes/syntaxLegibility.test.ts`

**Interfaces:**
- Consumes: `syntaxFromAnsi`, `statusFromAnsi`, `contrast`, `isHexColor`, `resolveVariant`, `listBuiltinThemes`.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `src/modules/theme/themes/syntaxLegibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { statusFromAnsi, syntaxFromAnsi } from "../derive";
import { contrast, isHexColor } from "../oklab";
import { resolveVariant } from "../resolveVariant";
import {
  STATUS_ROLES,
  SYNTAX_ROLES,
  type StatusTokens,
  type SyntaxPalette,
  type ThemeMode,
} from "../types";
import { listBuiltinThemes } from "./index";

const DIM = new Set(["comment", "gutterFg", "tagBracket"]);

type Case = {
  id: string;
  mode: ThemeMode;
  bg: string;
  card: string | undefined;
  syntax: SyntaxPalette;
  status: StatusTokens;
  rawAnsi: readonly string[];
};

const cases: Case[] = [];
const seen = new Set<string>();
for (const theme of listBuiltinThemes()) {
  for (const mode of ["light", "dark"] as ThemeMode[]) {
    const resolved = resolveVariant(theme, mode);
    if (!resolved) continue;
    // Key on the mode that actually supplied the variant, not the requested one.
    // A dark-only theme resolves to its dark variant in both modes, so using the
    // requested mode would label one case "(light)" while testing dark data, and
    // would count the same palette twice.
    const key = `${theme.id}:${resolved.mode}`;
    if (seen.has(key)) continue;
    const { variant } = resolved;
    const bg = variant.colors?.background;
    if (!isHexColor(bg) || !variant.terminal?.ansi) continue;
    const syntax = syntaxFromAnsi(variant.terminal, variant.colors, variant.syntax);
    const status = statusFromAnsi(variant.terminal, variant.colors, variant.status);
    if (!syntax || !status) continue;
    seen.add(key);
    cases.push({
      id: theme.id,
      mode: resolved.mode,
      bg,
      card: variant.colors?.card,
      syntax,
      status,
      rawAnsi: variant.terminal.ansi,
    });
  }
}

// 20 distinct combinations today: nine two-variant themes with an ansi palette,
// plus one case each for the two dark-only themes. Adding a theme raises this,
// so a failure here means coverage was lost.
it("covers every built-in that declares an ansi palette", () => {
  expect(cases.length).toBeGreaterThanOrEqual(20);
});

describe.each(cases.map((c) => [c.id, c.mode, c] as const))(
  "%s (%s) derived palette",
  (_id, _mode, c) => {
    // Assert hex rather than skipping on it. Vitest reports a body that returns
    // without asserting as passed, so an early return here would let malformed
    // output from the OKLab maths silently delete the floor check, which is the
    // exact regression this file exists to catch. The card check stays
    // conditional because `card` is legitimately optional on a variant.
    it.each(SYNTAX_ROLES.map((r) => [r, c.syntax[r]] as const))(
      "%s clears its floor against the app background",
      (role, color) => {
        expect(isHexColor(color)).toBe(true);
        const floor = DIM.has(role) ? 3 : 4.5;
        expect(contrast(color, c.bg)).toBeGreaterThanOrEqual(floor - 0.02);
      },
    );

    it.each(STATUS_ROLES.map((r) => [r, c.status[r]] as const))(
      "status %s clears 4.5:1 on canvas and card",
      (_role, color) => {
        expect(isHexColor(color)).toBe(true);
        expect(contrast(color, c.bg)).toBeGreaterThanOrEqual(4.48);
        if (isHexColor(c.card)) {
          expect(contrast(color, c.card)).toBeGreaterThanOrEqual(4.48);
        }
      },
    );

    // The "not invisible" rule terminalLegibility enforces for ansi, applied
    // to the derived output.
    it.each(SYNTAX_ROLES.map((r) => [r, c.syntax[r]] as const))(
      "%s is not the background",
      (_role, color) => {
        expect(color.toLowerCase()).not.toBe(c.bg.toLowerCase());
      },
    );
  },
);

// These two are authored to a contrast budget rather than transcribed from an
// upstream palette. If normalization ever has to touch them, either a floor or
// the mapping has drifted.
describe.each(["stardew", "kanagawa-dragon"])("%s needs no adjustment", (id) => {
  const themeCases = cases.filter((c) => c.id === id);

  // Guards the block against silently covering nothing if a theme is renamed or
  // stops declaring an ansi palette.
  it("contributes at least one derived case", () => {
    expect(themeCases.length).toBeGreaterThan(0);
  });

  // Driven by the cases that exist rather than by both modes, because a
  // dark-only theme contributes one case, not two.
  it.each(themeCases.map((c) => [c.mode, c] as const))("in %s mode", (_mode, c) => {
    for (const role of SYNTAX_ROLES) {
      if (role === "variable" || role === "operator") continue;
      expect(c.rawAnsi).toContain(c.syntax[role]);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/modules/theme/themes/syntaxLegibility.test.ts`
Expected: PASS. Measured before writing this plan: zero failures across all 22 theme and mode combinations, with `stardew` and `kanagawa-dragon` requiring zero adjustments.

If any case fails, do **not** relax the floor. The floors are the contract. Investigate the mapping table in `derive.ts` or the OKLab math in `oklab.ts` first.

- [ ] **Step 3: Commit**

```bash
git add src/modules/theme/themes/syntaxLegibility.test.ts
git commit -m "test(theme): guard derived palette contrast floors across builtins"
```

---

## Task 10: Migrate the status consumers

**Files:**
- Modify: `src/modules/explorer/lib/gitStatusColor.ts:4-15`
- Modify: `src/modules/git-history/GitHistoryPane.tsx:161-175, 790, 795, 1013, 1018`
- Modify: `src/modules/source-control/SourceControlPanel.tsx:137-152`
- Modify: `src/modules/editor/GitDiffPane.tsx:284, 287`
- Modify: `src/modules/statusbar/DiagnosticsBadge.tsx:24`
- Modify: `src/modules/statusbar/StatusBar.tsx:41`
- Modify: `src/modules/preview/PreviewPane.tsx:79`
- Modify: `src/modules/preview/PreviewAddressBar.tsx:206`
- Modify: `src/modules/lsp/components/LspStatusPill.tsx:245`
- Modify: `src/settings/components/LspServersGroup.tsx:86`
- Test: `src/styles/statusTokenAdoption.test.ts` (create)

**Interfaces:**
- Consumes: the `text-status-*` / `bg-status-*` utilities from Task 6.
- Produces: nothing.

Note `SourceControlPanel.tsx:102` (`bg-zinc-950 text-zinc-100`) is **left as is**. Its `dark:` duplication reads as a deliberate always-dark tooltip, so changing it is a design decision outside this work.

- [ ] **Step 1: Write the failing regression test**

Create `src/styles/statusTokenAdoption.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

// Only the hues that carry git and diagnostic meaning. Neutrals such as zinc
// are out of scope: SourceControlPanel's always-dark tooltip is a deliberate
// design choice, not a missing token, so it needs no allowlist entry.
const SEMANTIC_HUES =
  /\b(?:bg|text|border|ring|fill|stroke)-(?:emerald|amber|rose|sky|teal|green|red|yellow|blue)-\d{2,3}\b/;

describe("status colour adoption", () => {
  it("leaves no semantic status hue hardcoded anywhere", async () => {
    const { globSync } = await import("node:fs");
    const files = [
      ...globSync("src/**/*.tsx", { cwd: ROOT }),
      ...globSync("src/**/*.ts", { cwd: ROOT }),
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const src = readFileSync(path.resolve(ROOT, rel), "utf8");
      for (const line of src.split("\n")) {
        const m = line.match(SEMANTIC_HUES);
        if (m) offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/styles/statusTokenAdoption.test.ts`
Expected: FAIL, listing roughly 20 offending lines across 9 files.

- [ ] **Step 3: Migrate `gitStatusColor.ts`**

Replace the body of `src/modules/explorer/lib/gitStatusColor.ts`:

```ts
import type { GitStatusCode } from "./gitStatusUtils";

// Soft filename tint, new-VS-Code direction: color the name, no badges.
export function explorerGitTextClass(code: GitStatusCode): string {
  switch (code) {
    case "M":
      return "text-status-modified";
    case "A":
    case "U":
      return "text-status-added";
    case "R":
      return "text-status-renamed";
    case "D":
      return "text-status-deleted";
  }
}
```

- [ ] **Step 4: Migrate `GitHistoryPane.tsx`**

Replace `statusTone` at lines 161-175:

```ts
function statusTone(code: string): string {
  switch (code.toUpperCase()) {
    case "A":
      return "text-status-added";
    case "M":
      return "text-status-modified";
    case "D":
      return "text-status-deleted";
    case "R":
    case "C":
      return "text-status-renamed";
    default:
      return "text-muted-foreground";
  }
}
```

At line 790 replace `text-emerald-600/85 dark:text-emerald-400/85` with `text-status-added/85`.
At line 795 replace `text-rose-600/85 dark:text-rose-400/85` with `text-status-deleted/85`.
At line 1013 replace `text-emerald-600 dark:text-emerald-400` with `text-status-added`.
At line 1018 replace `text-rose-600 dark:text-rose-400` with `text-status-deleted`.

- [ ] **Step 5: Migrate `SourceControlPanel.tsx`**

Replace `statusAccent` at lines 137-152:

```ts
function statusAccent(code: string): string {
  switch (code) {
    case "A":
      return "bg-status-added/85";
    case "U":
      return "bg-status-conflict/85";
    case "M":
      return "bg-status-modified/85";
    case "D":
      return "bg-status-deleted/85";
    case "R":
      return "bg-status-renamed/85";
    default:
      return "bg-muted-foreground/40";
  }
}
```

- [ ] **Step 6: Migrate the remaining seven files**

`src/modules/editor/GitDiffPane.tsx:284` replace `text-emerald-600 dark:text-emerald-400` with `text-status-added`.
`src/modules/editor/GitDiffPane.tsx:287` replace `text-rose-600 dark:text-rose-400` with `text-status-deleted`.
`src/modules/statusbar/DiagnosticsBadge.tsx:24` replace `text-amber-700 dark:text-amber-400` with `text-status-warning`.
`src/modules/statusbar/StatusBar.tsx:41` replace `bg-amber-500/15` with `bg-status-warning/15` and `text-amber-700 dark:text-amber-400` with `text-status-warning`.
`src/modules/preview/PreviewPane.tsx:79` replace `bg-amber-500/8` with `bg-status-warning/8` and `text-amber-600 dark:text-amber-400` with `text-status-warning`.
`src/modules/preview/PreviewAddressBar.tsx:206` replace `bg-amber-500/8` with `bg-status-warning/8` and `text-amber-600 dark:text-amber-400` with `text-status-warning`.
`src/modules/lsp/components/LspStatusPill.tsx:245` replace `bg-emerald-500` with `bg-status-ok`.
`src/settings/components/LspServersGroup.tsx:86` replace `bg-emerald-500` with `bg-status-ok`.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/styles/statusTokenAdoption.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full check set**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/explorer/lib/gitStatusColor.ts src/modules/git-history/GitHistoryPane.tsx src/modules/source-control/SourceControlPanel.tsx src/modules/editor/GitDiffPane.tsx src/modules/statusbar/DiagnosticsBadge.tsx src/modules/statusbar/StatusBar.tsx src/modules/preview/PreviewPane.tsx src/modules/preview/PreviewAddressBar.tsx src/modules/lsp/components/LspStatusPill.tsx src/settings/components/LspServersGroup.tsx src/styles/statusTokenAdoption.test.ts
git commit -m "refactor(theme): route git and diagnostic colours through status tokens"
```

---

## Task 11: Fix the starter theme

**Files:**
- Modify: `src/modules/theme/themeFiles.ts:74-115`
- Test: `src/modules/theme/themeFiles.test.ts` (create)

**Interfaces:**
- Consumes: `validateTheme` from `./validateTheme`, `syntaxFromAnsi` from `./derive`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/modules/theme/themeFiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { syntaxFromAnsi } from "./derive";
import { starterTheme } from "./themeFiles";
import { validateTheme } from "./validateTheme";

describe("starterTheme", () => {
  // A single-variant starter silently hands a light-mode user the dark
  // palette, which is the exact trap THEME.md tells authors to avoid.
  it("defines both variants", () => {
    const t = starterTheme();
    expect(t.variants.light).toBeDefined();
    expect(t.variants.dark).toBeDefined();
  });

  it("declares the same colour keys in both variants", () => {
    const t = starterTheme();
    expect(Object.keys(t.variants.light?.colors ?? {}).sort()).toEqual(
      Object.keys(t.variants.dark?.colors ?? {}).sort(),
    );
  });

  it("ships an ansi palette in both variants so syntax derives immediately", () => {
    const t = starterTheme();
    for (const mode of ["light", "dark"] as const) {
      const v = t.variants[mode];
      expect(v?.terminal?.ansi).toHaveLength(16);
      expect(syntaxFromAnsi(v?.terminal, v?.colors, v?.syntax)).not.toBeNull();
    }
  });

  it("passes its own validator", () => {
    expect(validateTheme(JSON.parse(JSON.stringify(starterTheme()))).ok).toBe(
      true,
    );
  });

  it("uses a unique id per call", () => {
    expect(starterTheme().id).not.toBe(starterTheme().id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/theme/themeFiles.test.ts`
Expected: FAIL, `variants.light` is undefined.

- [ ] **Step 3: Rewrite starterTheme**

Replace `starterTheme` in `src/modules/theme/themeFiles.ts`:

```ts
export function starterTheme(): Theme {
  const id = `my-theme-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: "My Theme",
    description: "Custom theme.",
    variants: {
      dark: {
        colors: {
          background: "#0d0d10",
          foreground: "#e8e8ea",
          card: "#15151a",
          cardForeground: "#e8e8ea",
          popover: "#15151a",
          popoverForeground: "#e8e8ea",
          primary: "#7dd3fc",
          primaryForeground: "#0d0d10",
          muted: "#1c1c22",
          mutedForeground: "#a0a0a8",
          accent: "#1c1c22",
          accentForeground: "#e8e8ea",
          border: "rgba(255,255,255,0.08)",
          input: "rgba(255,255,255,0.12)",
          ring: "#7dd3fc",
        },
        terminal: {
          background: "#0d0d10",
          foreground: "#e8e8ea",
          cursor: "#e8e8ea",
          cursorAccent: "#0d0d10",
          selection: "rgba(125,211,252,0.22)",
          ansi: [
            "#1c1c22", "#f2777a", "#99cc99", "#ffcc66",
            "#6699cc", "#cc99cc", "#66cccc", "#d3d0c8",
            "#747369", "#f2777a", "#99cc99", "#ffcc66",
            "#6699cc", "#cc99cc", "#66cccc", "#f2f0ec",
          ],
        },
      },
      light: {
        colors: {
          background: "#fbfbfd",
          foreground: "#1a1a1f",
          card: "#ffffff",
          cardForeground: "#1a1a1f",
          popover: "#ffffff",
          popoverForeground: "#1a1a1f",
          primary: "#0369a1",
          primaryForeground: "#ffffff",
          muted: "#f0f0f4",
          mutedForeground: "#5a5a66",
          accent: "#f0f0f4",
          accentForeground: "#1a1a1f",
          border: "rgba(0,0,0,0.10)",
          input: "rgba(0,0,0,0.14)",
          ring: "#0369a1",
        },
        terminal: {
          background: "#fbfbfd",
          foreground: "#1a1a1f",
          cursor: "#1a1a1f",
          cursorAccent: "#fbfbfd",
          selection: "rgba(3,105,161,0.18)",
          ansi: [
            "#1a1a1f", "#c7254e", "#4c7a2f", "#8a6116",
            "#2b6cb0", "#8b4a8b", "#2a7f7f", "#5a5a66",
            "#747369", "#a01f42", "#3d6226", "#6f4e12",
            "#22548c", "#6f3b6f", "#216565", "#1a1a1f",
          ],
        },
      },
    },
  };
}
```

The `sidebar*` keys are dropped from the starter because `bg-sidebar` has zero usages, so shipping them taught authors to set inert tokens.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/theme/themeFiles.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/theme/themeFiles.ts src/modules/theme/themeFiles.test.ts
git commit -m "fix(theme): give the starter theme both variants and an ansi palette"
```

---

## Task 12: Documentation

**Files:**
- Modify: `THEME.md`
- Modify: `TERRA.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Correct the built-in list in TERRA.md**

In `TERRA.md`, find the `theme/` bullet under "Module layout". Replace the parenthesised theme list with the actual 12, in `BUILTIN` order:

```
built-in presets in `themes/` (terra-default, nothing, stardew, kanagawa,
kanagawa-dragon, everforest, gruvbox, tokyo-night, nord, caffeine, sage, tide)
```

Commit `140c64f` removed claude, catppuccin, rose-pine, dracula and solarized; the doc still lists them.

In the same bullet, add after the `validateTheme.ts` mention:

```
Syntax and status colours are derived from each theme's ANSI palette
(`derive.ts` + `oklab.ts`, both pure) rather than authored, so a theme colours
the editor and the git surfaces without declaring anything extra.
```

- [ ] **Step 2: Add the token documentation to THEME.md**

Add a new section after the `terminal` section:

```markdown
### `syntax` and `status` (variant-level, optional)

Both are **derived from your `terminal.ansi` palette**, so a theme that
declares 16 ANSI colours gets a matching editor and matching git colours for
free. Declare either block only to override a role.

Syntax roles and their source slot:

| Role | Slot | Role | Slot |
|---|---|---|---|
| `comment` | 8 | `type` | 14 |
| `keyword` | 5 | `operator` | foreground |
| `string` | 2 | `tag` | 1 |
| `number` | 3 | `tagBracket` | 8 |
| `constant` | 13 | `attr` | 11 |
| `func` | 4 | `attrValue` | 2 |
| `variable` | foreground | `heading` | 4 |
| `property` | 6 | `link` | 6 |
| `gutterFg` | 8 | `invalid` | 9 |

Status roles: `added` (2), `modified` (3), `deleted` (1), `renamed` (4),
`warning` (3), `conflict` (6), `ok` (2). Errors use `destructive`.

**Every derived value is lightness-normalized.** ANSI is tuned against the
terminal background, but the editor renders over `colors.background`, so each
value is raised in OKLab until it clears 4.5:1 there, or 3:1 for the three dim
roles (`comment`, `gutterFg`, `tagBracket`). Only lightness moves: hue and
chroma are preserved, so the colour stays yours. Status roles are normalized
against `card` as well.

This means a low-contrast ANSI palette produces legible syntax automatically,
and it also means the value you see may not be the exact hex you wrote. To pin
an exact value, set it in `syntax` and pick one that already clears the floor.

### Editor pairing and precedence

`editorTheme` still names a CodeMirror preset, but derivation outranks it:

```
syntax block  ->  derived from ansi  ->  editorTheme pairing  ->  fallback
```

So a theme with an ANSI palette gets derived syntax even if it names a preset.
`editorTheme` is the escape hatch for a theme that genuinely wants, say,
github-dark, and it is what themes with no ANSI palette fall back to. An
explicit editor-theme preference in Settings always wins over all of this.
```

Update the "Adding a token" checklist to mention `derive.ts` for a new syntax or status role, and update the "Before you ship" checklist to add:

```
- [ ] If the theme declares `terminal.ansi`, looked at the derived editor and a
      markdown code block side by side
```

- [ ] **Step 3: Verify the docs claims against the code**

Run: `grep -c 'bg-sidebar' src/ -r` (expect 0, which the THEME.md note about inert sidebar tokens depends on)
Run: `pnpm vitest run src/modules/theme/themes/syntaxLegibility.test.ts` (expect PASS, which the floors claim depends on)

- [ ] **Step 4: Commit**

```bash
git add THEME.md TERRA.md
git commit -m "docs: document derived syntax and status tokens"
```

---

## Task 13: Final verification

**Files:** none modified.

- [ ] **Step 1: Full check set**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all PASS.

- [ ] **Step 2: Rust checks, to confirm nothing crossed the boundary**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: PASS. This work is frontend-only, so this is a guard, not a change.

- [ ] **Step 3: Manual verification in the running app**

Run: `pnpm tauri dev`

Check each of these, because the tests catch dead and illegible colours but cannot say whether the result looks good:

1. Switch to **nothing**. Open a TypeScript file. Syntax should be monochrome with red accents, not kanagawa's purples. This is the headline fix.
2. Switch to **kanagawa**. Syntax should stay close to the kanagawa CodeMirror theme it used to pair with.
3. Switch to **terra-default**. Editor must look exactly as before (atomone), and git colours must be unchanged.
4. Open a markdown file with a fenced code block, in preview, beside an editor tab. The palettes should match.
5. In the explorer, modify, add, delete and rename files. Confirm the four tints track the active theme.
6. Open the source-control panel and confirm the accent dots track the theme.
7. Flip light and dark for **stardew** and confirm both read well.
8. Switch themes rapidly with several editor tabs open. There should be no flicker or reflow, since no extension is being swapped.

- [ ] **Step 4: Confirm the performance property**

With React DevTools Profiler recording, switch the app theme while an editor tab is focused. Confirm the CodeMirror `EditorView` does not remount and `useEditorThemeExt` returns a stable extension. Only CSS variables should change.

---

## Deferred follow-ups

Recorded here so they are not lost, each needing its own spec:

1. **Opacity dilution.** 323 sites apply an opacity modifier to a themeable colour (`border-border/60` alone appears 50 times), so an authored border renders at 60 percent. Large mechanical migration with visual-regression risk.
2. **Surface class adoption.** `.terra-slot` and `.terra-control` have 1 and 0 consumers, and `2026-07-27-themable-surfaces-design.md:152-153` specified them for cards, the input bar, buttons, tabs and window controls. Until adopted, `slotWidth`, `controlWidth`, `liftColor` and `liftDepth` render nowhere.
3. **Lazy CodeMirror preset registry.** `themes.ts` statically imports all 22 presets including 9 external `@uiw/codemirror-theme-*` packages. After this work most users derive instead, so per-id lazy loading is a real bundle win.
4. **`SourceControlPanel.tsx:102`** hardcodes an always-dark tooltip. Decide whether that is intended, and if not route it through `popover` tokens.
5. **`gitStatusColor.ts` groups `A` and `U`** on one colour while `SourceControlPanel` separates them. Reconcile.
