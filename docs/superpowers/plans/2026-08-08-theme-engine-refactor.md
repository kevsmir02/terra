# Theme Engine Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Terra's UI properly themeable by replacing the scattered token
definitions with one declarative registry, deriving defaults so nearly every key
becomes optional, and promoting the 363 hardcoded opacity modifiers into a
theme-owned emphasis ladder.

**Architecture:** A single `theme/tokens.ts` registry declares every token once
(CSS variable, kind, dependencies, derivation, docs). A pure
`resolveTheme(theme, mode) -> ThemeVar[]` walks that registry in topological
order; `applyTheme` becomes a thin DOM writer over its output, and
`validateTheme` generates its parser from the same table. Contrast-critical
derivation stays in TypeScript/oklab because CSS cannot solve for a ratio;
mechanical alpha blends emit `color-mix()`.

**Tech Stack:** TypeScript, React 19, Tailwind CSS 4.3.3 (`@theme inline`),
Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-08-08-theme-engine-refactor-design.md`

## Global Constraints

- **No em-dash** anywhere: code, comments, commits, docs. Use a hyphen or restructure.
- **No emojis** anywhere.
- **No AI attribution in commits.** Never add `Co-Authored-By` for an assistant or a "Generated with" line.
- **Comments:** default to none. Where genuinely needed, 1-2 lines on *why*, never *what*.
- **Imports:** always `@/...` on the frontend, never relative across modules.
- **pnpm only**, never npm/npx/yarn.
- **Lint gates on warnings.** `pnpm lint` runs `biome lint --error-on-warnings ./src`. A deliberate exception needs `// biome-ignore <rule>: <reason>` placed directly above the line the diagnostic anchors on, and JSX comment syntax is a parse error in expression position (after `return (` or `&& (`), so use a line comment there.
- **Full check suite:** `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`, `pnpm knip`, `pnpm audit --prod`, `pnpm size:eager`.
- **Single test file:** `pnpm exec vitest run <path>`.
- **Startup bundle budgets are enforced.** `eager-budget.json` is `index.html: 505`, `settings.html: 180`. The theme chunk is eager in both entries, so keep the registry free of heavy imports.
- **Contrast floors:** 4.5:1 for body-weight roles, 3:1 for the dim roles `comment`, `gutterFg`, `tagBracket`.

---

## File Structure

**Created:**

- `src/modules/theme/tokens.ts` - the registry. Declares every token once: key, CSS variable, group, kind, deps, derive, fallback, doc.
- `src/modules/theme/tokens.test.ts` - registry invariants (unique CSS vars, full role coverage, acyclic deps).
- `src/modules/theme/resolveTheme.ts` - pure `resolveTheme(theme, mode) -> ThemeVar[]`, topological walk with cycle detection.
- `src/modules/theme/resolveTheme.test.ts` - resolution behaviour plus the adversarial themes.
- `src/modules/theme/__snapshots__/resolveTheme.test.ts.snap` - resolved output for every builtin crossed with every mode.
- `src/modules/theme/diagnostics.ts` - `Diagnostic` type and severity helpers shared by validation and the UI.
- `src/styles/emphasis.test.ts` - the creep guard: no literal alpha modifier on a theme token in any `.tsx`.

**Modified:**

- `src/modules/theme/oklab.ts` - add `parseColor` so contrast maths works beyond hex.
- `src/modules/theme/applyTheme.ts` - shrinks to a DOM writer; the five mapping tables move to `tokens.ts`.
- `src/modules/theme/validateTheme.ts` - generates its parser from the registry; returns a diagnostics list.
- `src/modules/theme/customThemes.ts` - `sanitizeStoredThemes` carries diagnostics through instead of dropping silently.
- `src/modules/theme/derive.ts` - `syntaxFromAnsi`/`statusFromAnsi` become registry derivations; per-token resolution replaces the all-or-nothing `return null`.
- `src/styles/globals.css` - emphasis ladder defaults in `@theme inline`.
- `src/settings/sections/ThemesSection.tsx` - surface diagnostics.
- `THEME.md` - token reference generated from the registry.
- 363 call sites across `src/**/*.tsx` - literal alpha to ladder token.

---

### Task 1: Colour parsing so contrast works beyond hex

Today `ensureContrast` engages only when both colours are hex, so a theme
written in `rgb()` silently gets no legibility floor. This task removes that
restriction at the bottom of the stack.

**Files:**
- Modify: `src/modules/theme/oklab.ts`
- Test: `src/modules/theme/oklab.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseColor(v: string): [number, number, number] | null` returning
  8-bit RGB. `toOklab`, `contrast` and `ensureContrast` keep their existing
  signatures but accept any parseable notation.

- [ ] **Step 1: Write the failing test**

Add to `src/modules/theme/oklab.test.ts`:

```ts
import { contrast, parseColor } from "./oklab";

describe("parseColor", () => {
  it("parses the notations a theme may realistically use", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("#ffffff")).toEqual([255, 255, 255]);
    expect(parseColor("#ffffffcc")).toEqual([255, 255, 255]);
    expect(parseColor("rgb(255, 255, 255)")).toEqual([255, 255, 255]);
    expect(parseColor("rgba(255,255,255,0.5)")).toEqual([255, 255, 255]);
  });

  it("returns null for notations it cannot reason about", () => {
    expect(parseColor("oklch(0.7 0.1 200)")).toBeNull();
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("")).toBeNull();
  });
});

describe("contrast", () => {
  it("is notation independent", () => {
    expect(contrast("rgb(255,255,255)", "#000000")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "rgb(0,0,0)")).toBeCloseTo(21, 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/modules/theme/oklab.test.ts`
Expected: FAIL, `parseColor` is not exported.

- [ ] **Step 3: Implement `parseColor` and route the existing functions through it**

In `src/modules/theme/oklab.ts`, add above `toOklab`:

```ts
const RGB_FN = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/;

/**
 * 8-bit RGB for the notations contrast maths can reason about. Alpha is
 * dropped: a translucent colour has no fixed contrast, so callers that care
 * use `kind: "color"` and skip the maths entirely.
 */
export function parseColor(v: string | undefined): [number, number, number] | null {
  if (!v) return null;
  const s = v.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full =
      h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const m = RGB_FN.exec(s);
  if (!m) return null;
  const c = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (c.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return [c[0], c[1], c[2]];
}
```

Then change `toOklab` to take `string` and start with
`const rgb = parseColor(hex); if (!rgb) return [0, 0, 0];`, replacing its
hex-only slicing. Leave `isHexColor` exported; Task 5 removes its last callers.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/modules/theme/oklab.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify nothing else regressed**

Run: `pnpm test && pnpm check-types && pnpm lint`
Expected: all pass, including `syntaxLegibility` and `terminalLegibility`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/theme/oklab.ts src/modules/theme/oklab.test.ts
git commit -m "feat(theme): parse rgb() for contrast maths, not just hex"
```

---

### Task 2: The token registry

**Files:**
- Create: `src/modules/theme/tokens.ts`
- Test: `src/modules/theme/tokens.test.ts`

**Interfaces:**
- Consumes: `parseColor` from Task 1.
- Produces: `TOKENS: readonly TokenDef[]`, and the types `TokenDef`,
  `TokenKind`, `DerivedValues`. `TokenDef.key` is a dotted path into the
  variant (`"colors.background"`, `"syntax.keyword"`). `deps` lists the keys
  `derive` reads, which is what makes the topological sort possible.

- [ ] **Step 1: Write the failing test**

Create `src/modules/theme/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens";
import { STATUS_ROLES, SYNTAX_ROLES } from "./types";

describe("token registry", () => {
  it("maps each CSS variable exactly once", () => {
    const vars = TOKENS.map((t) => t.cssVar);
    expect(new Set(vars).size).toBe(vars.length);
  });

  it("uses each token key exactly once", () => {
    const keys = TOKENS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every syntax and status role", () => {
    for (const role of SYNTAX_ROLES) {
      expect(TOKENS.some((t) => t.key === `syntax.${role}`)).toBe(true);
    }
    for (const role of STATUS_ROLES) {
      expect(TOKENS.some((t) => t.key === `status.${role}`)).toBe(true);
    }
  });

  it("declares only dependencies that exist", () => {
    const keys = new Set(TOKENS.map((t) => t.key));
    for (const t of TOKENS) {
      for (const d of t.deps ?? []) expect(keys.has(d)).toBe(true);
    }
  });

  it("has an acyclic dependency graph", () => {
    const byKey = new Map(TOKENS.map((t) => [t.key, t]));
    const state = new Map<string, "open" | "done">();
    const visit = (key: string, trail: string[]): void => {
      if (state.get(key) === "done") return;
      if (state.get(key) === "open") {
        throw new Error(`cycle: ${[...trail, key].join(" -> ")}`);
      }
      state.set(key, "open");
      for (const d of byKey.get(key)?.deps ?? []) visit(d, [...trail, key]);
      state.set(key, "done");
    };
    expect(() => {
      for (const t of TOKENS) visit(t.key, []);
    }).not.toThrow();
  });

  it("documents every token", () => {
    for (const t of TOKENS) expect(t.doc.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/modules/theme/tokens.test.ts`
Expected: FAIL, cannot resolve `./tokens`.

- [ ] **Step 3: Create the registry**

Create `src/modules/theme/tokens.ts`. Start with the types and the full colour
group, porting every entry from `COLOR_VAR` in `applyTheme.ts:14-43`:

```ts
import { STATUS_ROLES, SYNTAX_ROLES } from "./types";

export type TokenKind =
  | "color"      // any CSS colour; no contrast maths (borders, selections, rings)
  | "textColor"  // must be readable; parseable into oklab; contrast enforced
  | "length"
  | "keyword"
  | "alpha";

export type DerivedValues = Readonly<Record<string, string | undefined>> & {
  readonly ansi?: readonly string[];
};

export type TokenDef = {
  /** Dotted path into the variant, e.g. "colors.background". */
  key: string;
  cssVar: string;
  group: "colors" | "terminal" | "shape" | "type" | "syntax" | "status" | "emphasis";
  kind: TokenKind;
  /** Keys `derive` reads. Drives the topological order. */
  deps?: readonly string[];
  derive?: (d: DerivedValues) => string | undefined;
  fallback?: string;
  keywords?: readonly string[];
  doc: string;
};

export const TOKENS: readonly TokenDef[] = [
  { key: "colors.background", cssVar: "--background", group: "colors",
    kind: "color", doc: "App canvas." },
  { key: "colors.foreground", cssVar: "--foreground", group: "colors",
    kind: "textColor", doc: "Primary text on the canvas." },
  { key: "colors.card", cssVar: "--card", group: "colors", kind: "color",
    deps: ["colors.background"], derive: (d) => d["colors.background"],
    doc: "Raised surface. Falls back to the canvas." },
  { key: "colors.cardForeground", cssVar: "--card-foreground", group: "colors",
    kind: "textColor", deps: ["colors.foreground"],
    derive: (d) => d["colors.foreground"],
    doc: "Text on card surfaces." },
  // ...continue for every key in COLOR_VAR (applyTheme.ts:14-43).
];
```

Port the remaining groups the same way, one entry per variable in `SHAPE_VAR`
(`applyTheme.ts:45-60`), `TYPE_VAR` (62-68), `SYNTAX_VAR` (89-108) and
`STATUS_VAR` (110-118), plus the terminal variables and the 16 `ANSI_VARS`.

For shape, copy the defaults from the THEME.md shape table verbatim into
`fallback` (`frameWidth` `1px`, `frameRadius` `12px`, `framePadding` `0px`,
`chromeWidth`/`panelWidth`/`slotWidth`/`controlWidth` `1px`, `bevelWidth` `0px`,
`bevelOuter`/`bevelMid`/`bevelInner` `transparent`, `liftColor` `transparent`,
`liftDepth` `0px`, `spacing` `0.25rem`).

For syntax and status, port the slot indices from `SYNTAX_SLOT`
(`derive.ts:13-18`) and `STATUS_SLOT` (`derive.ts:20-23`) into `derive`
functions that read `d.ansi`. Give `syntax.variable` and `syntax.operator`
`deps: ["colors.foreground"]` per `derive.ts:52`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/modules/theme/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/theme/tokens.ts src/modules/theme/tokens.test.ts
git commit -m "feat(theme): declare every token once in a registry"
```

---

### Task 3: Pure resolution with parity snapshots

**Files:**
- Create: `src/modules/theme/resolveTheme.ts`, `src/modules/theme/resolveTheme.test.ts`
- Test: `src/modules/theme/resolveTheme.test.ts`

**Interfaces:**
- Consumes: `TOKENS`, `TokenDef`, `DerivedValues` (Task 2); `parseColor`,
  `ensureContrast` (Task 1); `resolveVariant` from `./resolveVariant`.
- Produces: `resolveTheme(theme: Theme, mode: ThemeMode): ThemeVar[] | null`,
  reusing the existing `ThemeVar = readonly [name: string, value: string]`
  exported by `applyTheme.ts:136`.

- [ ] **Step 1: Write the failing test, including the adversarial themes**

Create `src/modules/theme/resolveTheme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveTheme } from "./resolveTheme";
import { listBuiltinThemes } from "./themes";
import type { Theme, ThemeMode } from "./types";

const MODES: ThemeMode[] = ["light", "dark"];
const get = (vars: readonly (readonly [string, string])[], name: string) =>
  vars.find(([n]) => n === name)?.[1];

describe("resolveTheme", () => {
  it("resolves every builtin in both modes to a stable variable set", () => {
    for (const theme of listBuiltinThemes()) {
      for (const mode of MODES) {
        expect({ id: theme.id, mode, vars: resolveTheme(theme, mode) })
          .toMatchSnapshot(`${theme.id}-${mode}`);
      }
    }
  });

  // Audit bug: a missing foreground used to null all 18 syntax vars.
  it("degrades one token, not the whole syntax palette, when foreground is absent", () => {
    const theme: Theme = {
      id: "no-fg", name: "No Foreground",
      variants: { dark: { colors: { background: "#101010" },
        terminal: { ansi: Array(16).fill("#8899aa") as never } } },
    };
    const vars = resolveTheme(theme, "dark");
    expect(vars).not.toBeNull();
    expect(get(vars ?? [], "--syntax-keyword")).toBeDefined();
    expect(get(vars ?? [], "--syntax-string")).toBeDefined();
  });

  // Audit bug: contrast used to be enforced only when both colours were hex.
  it("enforces contrast for rgb() themes, not only hex ones", () => {
    const theme: Theme = {
      id: "rgb-theme", name: "RGB",
      variants: { dark: {
        colors: { background: "rgb(16,16,16)", foreground: "rgb(240,240,240)" },
        terminal: { ansi: Array(16).fill("rgb(20,20,20)") as never },
      } },
    };
    const vars = resolveTheme(theme, "dark");
    const keyword = get(vars ?? [], "--syntax-keyword");
    expect(keyword).toBeDefined();
    // A near-black keyword on a near-black canvas must have been lifted.
    expect(keyword).not.toBe("rgb(20,20,20)");
  });

  it("returns null when the theme has no usable variant", () => {
    expect(resolveTheme({ id: "empty", name: "Empty", variants: {} }, "dark"))
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/modules/theme/resolveTheme.test.ts`
Expected: FAIL, cannot resolve `./resolveTheme`.

- [ ] **Step 3: Implement the resolver**

Create `src/modules/theme/resolveTheme.ts`. Resolve in topological order of
`deps`, reading the authored value first, then `derive`, then `fallback`:

```ts
export function resolveTheme(theme: Theme, mode: ThemeMode): ThemeVar[] | null {
  const resolved = resolveVariant(theme, mode);
  if (!resolved) return null;
  const { variant } = resolved;

  const byKey = new Map(TOKENS.map((t) => [t.key, t]));
  const values: Record<string, string | undefined> = {};
  const ansi = variant.terminal?.ansi;
  const done = new Set<string>();

  const resolveOne = (key: string): void => {
    if (done.has(key)) return;
    done.add(key);
    const def = byKey.get(key);
    if (!def) return;
    for (const d of def.deps ?? []) resolveOne(d);
    const authored = readAuthored(variant, key);
    values[key] =
      authored ?? def.derive?.({ ...values, ansi }) ?? def.fallback;
  };

  for (const t of TOKENS) resolveOne(t.key);

  const out: ThemeVar[] = [];
  for (const t of TOKENS) {
    const v = values[t.key];
    if (v !== undefined) out.push([t.cssVar, v]);
  }
  return out;
}
```

`readAuthored` splits the dotted key and indexes the variant. Cycle safety comes
from the `done` set marking before recursing, which is why Task 2's acyclic test
matters: a cycle in the registry would otherwise silently resolve to `undefined`
rather than looping.

Contrast enforcement lives in the `derive` functions for `kind: "textColor"`
tokens, calling `ensureContrast(value, background, floor)` with 3 for `comment`,
`gutterFg` and `tagBracket` and 4.5 otherwise.

- [ ] **Step 4: Run and record the snapshots**

Run: `pnpm exec vitest run src/modules/theme/resolveTheme.test.ts`
Expected: PASS, writing `__snapshots__/resolveTheme.test.ts.snap`.

Read the snapshot file. It is the review artifact for the whole refactor. Every
builtin should differ from today only where the spec says it should. Investigate
anything else before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/theme/resolveTheme.ts src/modules/theme/resolveTheme.test.ts \
        src/modules/theme/__snapshots__
git commit -m "feat(theme): resolve tokens from the registry in one pure pass"
```

---

### Task 4: Point applyTheme at the resolver

**Files:**
- Modify: `src/modules/theme/applyTheme.ts`
- Test: `src/modules/theme/applyTheme.test.ts`

**Interfaces:**
- Consumes: `resolveTheme` (Task 3), `TOKENS` (Task 2).
- Produces: `applyTheme` and `clearTheme` keep their signatures. `ALL_VARS`
  derives from `TOKENS`. `resolveThemeVars` is deleted.

- [ ] **Step 1: Update the test to assert the mapping comes from the registry**

In `src/modules/theme/applyTheme.test.ts`, add:

```ts
import { TOKENS } from "./tokens";
import { ALL_VARS } from "./applyTheme";

it("clears exactly the variables the registry declares", () => {
  expect([...ALL_VARS].sort()).toEqual(TOKENS.map((t) => t.cssVar).sort());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/modules/theme/applyTheme.test.ts`
Expected: FAIL, `ALL_VARS` still comes from the local tables.

- [ ] **Step 3: Shrink applyTheme to a DOM writer**

Delete `COLOR_VAR`, `SHAPE_VAR`, `TYPE_VAR`, `ANSI_VARS`, `SYNTAX_VAR`,
`STATUS_VAR`, `resolveThemeVars`, `collectColors`, `collectShape`,
`collectType` and `collectTerminal`. Replace with:

```ts
export const ALL_VARS: readonly string[] = TOKENS.map((t) => t.cssVar);

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const vars = resolveTheme(theme, mode);
  if (!vars) {
    clearTheme();
    return;
  }
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  for (const [name, value] of vars) root.style.setProperty(name, value);
  lastApplied = theme.id;
}
```

Keep `clearTheme` and the `lastApplied` guard as they are.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test && pnpm check-types && pnpm lint`
Expected: PASS. `derive.ts` may now have unused exports; leave them, Task 8 removes them.

- [ ] **Step 5: Commit**

```bash
git add src/modules/theme/applyTheme.ts src/modules/theme/applyTheme.test.ts
git commit -m "refactor(theme): applyTheme writes what the registry resolves"
```

---

### Task 5: Registry-driven validation with diagnostics

**Files:**
- Create: `src/modules/theme/diagnostics.ts`
- Modify: `src/modules/theme/validateTheme.ts`
- Test: `src/modules/theme/validateTheme.test.ts`

**Interfaces:**
- Consumes: `TOKENS`, `TokenKind` (Task 2); `parseColor` (Task 1).
- Produces: `type Diagnostic = { severity: "error" | "warning"; path: string; message: string }`
  from `diagnostics.ts`, and
  `validateTheme(raw): { ok: true; theme: Theme; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] }`.

- [ ] **Step 1: Write the failing tests**

Add to `src/modules/theme/validateTheme.test.ts`:

```ts
it("reports every bad key, not just the first", () => {
  const res = validateTheme({
    id: "x", name: "X",
    variants: { dark: { colors: { background: "nope", foreground: "also-nope" } } },
  });
  expect(res.ok).toBe(false);
  expect(res.diagnostics.filter((d) => d.severity === "error")).toHaveLength(2);
});

it("treats an unknown key as a warning so newer themes still load", () => {
  const res = validateTheme({
    id: "x", name: "X",
    variants: { dark: { colors: { background: "#101010", spork: "#fff" } } },
  });
  expect(res.ok).toBe(true);
  expect(res.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "warning", path: "variants.dark.colors.spork" }),
  );
});

it("rejects an unparseable textColor but accepts it for a plain color", () => {
  const bad = validateTheme({
    id: "x", name: "X",
    variants: { dark: { colors: { foreground: "oklch(0.7 0.1 200)" } } },
  });
  expect(bad.ok).toBe(false);

  const ok = validateTheme({
    id: "y", name: "Y",
    variants: { dark: { colors: { border: "rgba(255,255,255,0.08)" } } },
  });
  expect(ok.ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/modules/theme/validateTheme.test.ts`
Expected: FAIL, `diagnostics` is not on the result.

- [ ] **Step 3: Implement**

Create `src/modules/theme/diagnostics.ts` with the `Diagnostic` type.

In `validateTheme.ts`, replace `COLOR_KEYS`, `SHAPE_LENGTH_KEYS`,
`SHAPE_COLOR_KEYS` and `TYPE_STRING_KEYS` with a lookup built from `TOKENS`
grouped by `group`. Drive each value check off `kind`:

- `"color"` - reuse the existing `COLOR_RE` at `validateTheme.ts:56`, which
  already accepts `transparent`, hex 3/6/8 and the CSS colour functions.
- `"textColor"` - must satisfy `COLOR_RE` **and** `parseColor` must return
  non-null, since contrast maths has to be able to reason about it.
- `"length"` - the existing `LENGTH_RE`.
- `"keyword"` - membership in `def.keywords`.
- `"alpha"` - a number in `[0, 1]`.

Accumulate into a `Diagnostic[]` rather than returning early. Unknown keys push
a warning and are skipped. `ok` is `false` only when at least one `error` exists.

Update the callers: `themeFiles.ts:61` (`parseThemeFile`), `customThemes.ts:16`
(`sanitizeStoredThemes`), and `useThemeFileEditing.ts`.

- [ ] **Step 4: Run and verify**

Run: `pnpm test && pnpm check-types && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/theme/diagnostics.ts src/modules/theme/validateTheme.ts \
        src/modules/theme/validateTheme.test.ts src/modules/theme/themeFiles.ts \
        src/modules/theme/customThemes.ts src/modules/theme/useThemeFileEditing.ts
git commit -m "feat(theme): validate from the registry and report all diagnostics"
```

---

### Task 6: Surface diagnostics instead of dropping themes silently

**Files:**
- Modify: `src/modules/theme/customThemes.ts`, `src/settings/sections/ThemesSection.tsx`
- Test: `src/modules/theme/customThemes.test.ts`

**Interfaces:**
- Consumes: `Diagnostic`, `validateTheme` (Task 5).
- Produces: `sanitizeStoredThemes(raw): { themes: Theme[]; rejected: { id: string; diagnostics: Diagnostic[] }[] }`.

- [ ] **Step 1: Write the failing test**

```ts
it("reports which stored theme was rejected and why", () => {
  const res = sanitizeStoredThemes([
    { id: "good", name: "Good", variants: { dark: { colors: { background: "#101010" } } } },
    { id: "bad", name: "Bad", variants: { dark: { colors: { background: "nope" } } } },
  ]);
  expect(res.themes.map((t) => t.id)).toEqual(["good"]);
  expect(res.rejected).toHaveLength(1);
  expect(res.rejected[0].id).toBe("bad");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/modules/theme/customThemes.test.ts`
Expected: FAIL, `sanitizeStoredThemes` returns an array.

- [ ] **Step 3: Implement and surface in Settings**

Change the return shape and update `listCustomThemes` to keep returning
`Theme[]` for existing callers while exposing `listCustomThemesWithDiagnostics`
for the Settings panel. In `ThemesSection.tsx`, render rejected themes as a
short list with their first error, and show warnings on import rather than
discarding them.

- [ ] **Step 4: Run and verify**

Run: `pnpm test && pnpm check-types && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/theme/customThemes.ts src/modules/theme/customThemes.test.ts \
        src/settings/sections/ThemesSection.tsx
git commit -m "feat(theme): tell the user which theme failed and why"
```

---

### Task 7: Emphasis ladder

**Files:**
- Modify: `src/modules/theme/tokens.ts`, `src/styles/globals.css`
- Test: `src/modules/theme/tokens.test.ts`

**Interfaces:**
- Consumes: `TokenDef` (Task 2).
- Produces: six tokens in group `"emphasis"`, kind `"alpha"`, with CSS
  variables `--emph-faint`, `--emph-subtle`, `--emph-soft`, `--emph-medium`,
  `--emph-strong`, `--emph-bold`.

- [ ] **Step 1: Write the failing test**

```ts
it("declares the emphasis ladder with its modal defaults", () => {
  const ladder = TOKENS.filter((t) => t.group === "emphasis");
  expect(ladder.map((t) => [t.cssVar, t.fallback])).toEqual([
    ["--emph-faint", "0.1"],
    ["--emph-subtle", "0.3"],
    ["--emph-soft", "0.4"],
    ["--emph-medium", "0.5"],
    ["--emph-strong", "0.6"],
    ["--emph-bold", "0.85"],
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/modules/theme/tokens.test.ts`
Expected: FAIL, no emphasis tokens.

- [ ] **Step 3: Add the tokens and the CSS defaults**

Append to `TOKENS`, one entry per step, for example:

```ts
{ key: "emphasis.strong", cssVar: "--emph-strong", group: "emphasis",
  kind: "alpha", fallback: "0.6",
  doc: "Default border and divider weight. Absorbs the old /60, /65 and /70." },
```

In `src/styles/globals.css`, inside the existing `@theme inline` block, add the
same six defaults so the ladder resolves before any theme is applied:

```css
--emph-faint: 0.1;
--emph-subtle: 0.3;
--emph-soft: 0.4;
--emph-medium: 0.5;
--emph-strong: 0.6;
--emph-bold: 0.85;
```

- [ ] **Step 4: Run and verify**

Run: `pnpm exec vitest run src/modules/theme/tokens.test.ts && pnpm build`
Expected: PASS and a clean build.

- [ ] **Step 5: Commit**

```bash
git add src/modules/theme/tokens.ts src/modules/theme/tokens.test.ts src/styles/globals.css
git commit -m "feat(theme): add the theme-owned emphasis ladder"
```

---

### Task 8: Migrate the call sites and lock them

**Files:**
- Modify: 363 sites across `src/**/*.tsx`; `src/modules/source-control/SourceControlPanel.tsx:102`
- Create: `src/styles/emphasis.test.ts`
- Modify: `src/modules/theme/derive.ts`

**Interfaces:**
- Consumes: the ladder (Task 7).
- Produces: no literal alpha modifier on a theme token anywhere in `src/**/*.tsx`.

- [ ] **Step 1: Write the creep guard first**

Create `src/styles/emphasis.test.ts`:

```ts
import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TOKEN = "(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|sidebar)";
const LITERAL_ALPHA = new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|divide|outline)-${TOKEN}[a-z-]*\\/[0-9]{1,3}\\b`);

describe("emphasis ladder", () => {
  it("has no literal alpha modifiers left on theme tokens", () => {
    const offenders: string[] = [];
    for (const file of globSync("src/**/*.tsx")) {
      const src = readFileSync(file, "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        if (LITERAL_ALPHA.test(line)) offenders.push(`${file}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/styles/emphasis.test.ts`
Expected: FAIL, listing roughly 363 offending locations.

- [ ] **Step 3: Migrate with a codemod**

Map each literal to its ladder step, per the spec table:

| Literal | Replacement |
| --- | --- |
| `/5`, `/10`, `/15` | `/(--emph-faint)` |
| `/20`, `/25`, `/30`, `/35` | `/(--emph-subtle)` |
| `/40`, `/45` | `/(--emph-soft)` |
| `/50`, `/55` | `/(--emph-medium)` |
| `/60`, `/65`, `/70`, `/75` | `/(--emph-strong)` |
| `/80`, `/85`, `/90`, `/95` | `/(--emph-bold)` |

Apply it only to the token names in the `TOKEN` alternation above, so unrelated
utilities such as `w-1/2` and non-theme colours are untouched.

Then fix the one genuinely unthemeable surface by hand.
`SourceControlPanel.tsx:102` currently reads:

```
"border border-border/70 bg-zinc-950 text-zinc-100 shadow-lg shadow-black/30 dark:border-border/60 dark:bg-zinc-950 dark:text-zinc-100"
```

Replace `bg-zinc-950` with `bg-popover`, `text-zinc-100` with
`text-popover-foreground`, and drop the now-redundant `dark:` duplicates of
those two, since the tokens already differ per variant.

- [ ] **Step 4: Verify behaviour and appearance**

Run: `pnpm exec vitest run src/styles/emphasis.test.ts && pnpm test && pnpm build`
Expected: PASS.

Then run `pnpm exec vitest run src/modules/theme/resolveTheme.test.ts` and
confirm the snapshots are unchanged: the ladder changes call sites, not resolved
theme variables, so any snapshot movement here means the codemod touched
something it should not have.

- [ ] **Step 5: Commit**

```bash
git add src/ && git commit -m "refactor(ui): drive emphasis from the ladder, not literal alphas"
```

---

### Task 9: Generate the token reference and delete the old tables

**Files:**
- Modify: `THEME.md`, `src/modules/theme/derive.ts`, `src/modules/theme/index.ts`
- Create: `scripts/theme-token-reference.mjs`
- Test: `src/modules/theme/tokens.test.ts`

**Interfaces:**
- Consumes: `TOKENS` (Task 2).
- Produces: a generated token table in THEME.md, checked by a test so it cannot drift.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { renderTokenReference } from "../../../scripts/theme-token-reference.mjs";

it("keeps the THEME.md token reference in sync with the registry", () => {
  const doc = readFileSync("THEME.md", "utf8");
  expect(doc).toContain(renderTokenReference(TOKENS));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/modules/theme/tokens.test.ts`
Expected: FAIL, the script does not exist.

- [ ] **Step 3: Implement the generator and regenerate**

Create `scripts/theme-token-reference.mjs` exporting
`renderTokenReference(tokens)`, which emits a markdown table of
key, variable, default and doc, grouped by `group`, between the markers
`<!-- token-reference:start -->` and `<!-- token-reference:end -->`.

Add those markers to THEME.md around the existing token reference and replace
its body with the generated output. Then delete the now-dead
`syntaxFromAnsi`/`statusFromAnsi` from `derive.ts` along with `SYNTAX_SLOT` and
`STATUS_SLOT`, whose logic now lives in the registry's `derive` functions, and
drop their re-exports.

- [ ] **Step 4: Run the whole suite**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build && pnpm knip && pnpm size:eager`
Expected: all pass. `knip` catching a newly unused export means a table was
missed; delete it.

- [ ] **Step 5: Commit**

```bash
git add THEME.md scripts/theme-token-reference.mjs src/modules/theme/
git commit -m "docs(theme): generate the token reference from the registry"
```

---

## Self-Review

**Spec coverage.** Registry (Task 2), derived defaults (Tasks 2-3), emphasis
ladder (Tasks 7-8), pure resolution (Task 3), all-or-nothing bug (Task 3 test),
two-tier contrast bug (Tasks 1, 3, 5), collect-all diagnostics and unknown-key
warnings (Task 5), silent stored-theme drop (Task 6), snapshots and adversarial
themes and creep guard (Tasks 3, 8), generated reference and table deletion
(Task 9), the hardcoded surface (Task 8). The spec's rollout order maps to the
task order.

**Type consistency.** `ThemeVar` is the existing tuple from `applyTheme.ts:136`,
reused rather than redefined. `Diagnostic` is defined once in Task 5 and
consumed unchanged in Task 6. `TokenDef.key` is dotted throughout.
`resolveTheme` returns `ThemeVar[] | null`, matching the null case the old
`resolveThemeVars` had and that `applyTheme` already handles.

**Known gap, deliberately left.** Task 8's codemod is mechanical and its safety
net is the creep guard plus the unchanged resolve snapshots. Neither proves the
UI *looks* right, because nothing in this repo does visual regression. The
appearance check is manual: run the app, switch through several builtins, and
look at borders and rings in particular.
