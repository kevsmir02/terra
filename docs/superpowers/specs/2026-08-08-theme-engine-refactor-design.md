# Design: Theme Engine Refactor - Registry, Derived Defaults, Emphasis Tokens

**Date:** 2026-08-08
**Status:** Approved (design). Implementation plan to follow.

## Goal

Make Terra's UI properly and easily themeable by fixing the three things that
make it hard today:

1. **Themes cannot control how the UI reads.** 363 hardcoded opacity modifiers
   (`border-border/60` and friends) bake emphasis into the components. A theme
   sets `--border` but cannot make borders solid or softer.
2. **Authoring is laborious.** A theme hand-writes roughly 28 colour keys per
   variant before it looks finished, because almost nothing is derived.
3. **Changing the token system is painful.** Adding one token means five
   parallel edits (`types.ts`, `applyTheme.ts`, `validateTheme.ts`,
   `globals.css`, tests) kept in sync by convention rather than by the compiler.

Terra already has a real theme engine (43 files, ~4400 lines, 13 test files, no
`next-themes`). This is a refactor of that engine, not a replacement.

## Decision context

Established during brainstorming:

- **Scope:** all three pains in one coherent pass. They are layers of one
  subsystem, not independent projects.
- **Compatibility:** none required. Nothing depends on stored user themes
  rendering identically, so no schema versioning and no migrator. The 12
  built-in themes did ship in 0.8.8/0.8.9, so gratuitous visual churn in them is
  still avoided, but they are not preserved byte for byte.
- **Authoring target:** keep the full ~28-key vocabulary and make nearly all of
  it optional with derived defaults. Not a seed-only redesign.

### Rejected alternatives

- **CSS-native derivation** (`color-mix()` and relative colour syntax in
  `globals.css` instead of TypeScript). Rejected because CSS cannot solve for a
  contrast ratio. `ensureContrast` walks lightness in oklab until it clears
  4.5:1, and `syntaxLegibility`/`terminalLegibility` assert that across every
  builtin. Moving derivation into CSS would trade a tested legibility guarantee
  for terser stylesheets and would make the two-tier contrast bug permanent.
- **Targeted fixes without a registry.** Rejected because it leaves the
  five-parallel-edit problem intact, which was one of the three stated pains.
  New emphasis tokens would drift out of `validateTheme` the next time one is
  added.
- **Per-surface emphasis tokens** (~45 tokens like `--border-subtle`,
  `--ring-faint`). Rejected for now under YAGNI in favour of a 6-step ladder.
  See "Emphasis" below for the trade-off and the escape hatch.

## Architecture: the token registry

`theme/tokens.ts` declares every token exactly once. `applyTheme`,
`validateTheme`, `ALL_VARS` and the THEME.md token reference all read from it.
Adding a token becomes one edit, and drift becomes impossible by construction
rather than caught by review.

Three representative entries:

```ts
// A colour token with a derived default.
{ key: "cardForeground", cssVar: "--card-foreground", group: "colors",
  kind: "textColor",
  derive: (r) => r.foreground,
  doc: "Text on card surfaces." }

// A shape token: no derivation, just a fallback and a validator.
{ key: "frameRadius", cssVar: "--frame-radius", group: "shape",
  kind: "length", fallback: "10px",
  doc: "Outer window corner radius." }

// A derived syntax role, contrast enforced.
{ key: "syntax.keyword", cssVar: "--syntax-keyword", group: "syntax",
  kind: "textColor",
  derive: (r) => contrastFloor(r.ansi[5], r.background, 4.5),
  doc: "Keywords. Falls back to ANSI magenta." }
```

Two properties make this work:

- **`derive` receives already-resolved tokens**, not the raw theme. Defaults
  compose (`cardForeground` -> `foreground` -> its own fallback) and resolution
  is a topological walk.
- **`kind` drives validation.** `"color"` finally means "parsed as a colour"
  rather than "non-empty string".

### Deliberate split: where derivation happens

Contrast-critical derivation stays in TypeScript/oklab, because CSS cannot solve
for a ratio. Purely mechanical derivation (the alpha blends below) emits
`color-mix()` instead, which costs nothing at runtime and works with any colour
notation the theme used.

## Emphasis: the alpha ladder

### The problem in numbers

363 hardcoded opacity modifiers across the UI, but only 118 distinct
(token, alpha) pairs, and the alphas cluster hard: `/60` appears 76 times, then
50 (42), 40 (41), 30 (27), 10 (27), 70 (26), 20 (23). This is one emphasis scale
that was never named, so each site picked a number by eye.

### The ladder

Six theme-owned steps, registered like any other token:

| Step | Default | Absorbs | Sites |
| --- | --- | --- | --- |
| `--emph-faint` | 0.10 | 5, 10 | 42 |
| `--emph-subtle` | 0.30 | 20, 30 | 50 |
| `--emph-soft` | 0.40 | 40, 45 | 49 |
| `--emph-medium` | 0.50 | 50, 55 | 50 |
| `--emph-strong` | 0.60 | 60, 65, 70 | 102 |
| `--emph-bold` | 0.85 | 80, 85, 90, 95 | 57 |

Each default is the **modal** value of its cluster. That keeps roughly 250 of
the 363 sites rendering exactly as they do today, including `border-border/60`
which is the single most common surface in the app, and moves only the minority
by at most 10 alpha points.

The six clusters account for 350 sites. The remaining 13 use off-ladder values
(`/15`, `/35`, `/65`, `/75`) that appear fewer than four times each; the codemod
snaps them to the nearest step, which is the normalization this refactor exists
to perform. No site keeps a literal alpha, otherwise the creep guard below would
have to carve out exceptions and would stop meaning anything.

### Call sites

`border-border/60` becomes `border-border/(--emph-strong)`.

Verified against the real pipeline, not assumed: Tailwind 4.3.3 generates
`.border-border\/\(--emph-strong\)` and wraps the blend in
`@supports (color: color-mix(in lab, red, red))`, falling back to fully opaque.
So older webviews degrade to opaque rather than broken.

### Trade-off

Six tokens instead of forty-five, for the same authoring power. The cost is that
a theme shifts emphasis globally: it cannot say "stronger borders, unchanged
muted text" without overriding the base colour. If that need becomes real, a
semantic token can be added for that one surface without disturbing the ladder.

Also folded in: `SourceControlPanel.tsx:102` (`bg-zinc-950 text-zinc-100`), the
one genuinely unthemeable surface left in the codebase, becomes tokens.

## Resolution pipeline

`resolveTheme(theme, mode) -> ThemeVar[]` becomes the single pure function.
`applyTheme` shrinks to a DOM writer over its output. Nothing else computes
colour.

Resolution walks the registry in topological order of `derive` dependencies, so
a token always sees resolved inputs. Cycles fail loudly at test time rather than
producing `undefined` at runtime. Each token resolves independently:

```
authored value -> derive(resolved) -> fallback -> omit
```

### Fix: all-or-nothing syntax derivation

Today `syntaxFromAnsi` returns `null` when any role resolves to `undefined`.
Because `variable` and `operator` fall back to
`terminal.foreground ?? colors.foreground`, a theme with `terminal.ansi` but no
foreground anywhere drops **all 18** syntax variables silently. `validateTheme`
does not require `foreground`, so this is reachable with a theme the validator
accepts.

Per-token resolution fixes this structurally: a missing input degrades exactly
one token, and only when that token has no fallback either.

### Fix: two-tier contrast guarantee

Today `ensureContrast` engages only when both the colour and the background are
hex, so a theme written in `rgb()` silently receives no legibility floor while a
hex theme gets 4.5:1 (3:1 for the dim roles `comment`, `gutterFg`,
`tagBracket`).

Requiring hex everywhere would reject the project's own `starterTheme()`, which
uses `rgba(255,255,255,0.08)` for borders. The fix is to split the kind:

- **`kind: "color"`** accepts any supported CSS colour and gets no contrast
  maths. Correct for borders, selections and rings, where translucency is the
  point and "contrast" is not meaningful.
- **`kind: "textColor"`** is for values that must be readable (syntax roles,
  status tokens, the `*-foreground` family) and requires a notation the engine
  can convert, enforcing the floors universally.

### The two allowlists must agree

`validateTheme.ts:56` already has a `COLOR_RE` that accepts `transparent`, hex
3/6/8, and `rgb|rgba|hsl|hsla|oklch|oklab|lab|lch`. Any notation that `COLOR_RE`
accepts but the contrast maths cannot convert becomes a token that validates as
a `color` and fails as a `textColor`, which is an inconsistency an author would
have to memorize:

```jsonc
"border":     "oklch(0.30 0.02 250)",  // accepted
"foreground": "oklch(0.90 0.02 250)",  // rejected
```

So the supported set is defined once and both sides are held to it:

**Supported:** hex 3/6/8, `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`,
`oklab()`.

`oklch` and `oklab` are not concessions, they are the natural notation here. The
engine's whole derivation model is oklab, so `oklch(L C H)` converts with
`a = C·cos(H)`, `b = C·sin(H)` and `oklab(L a b)` is the identity. Hex is the
notation that costs more, needing sRGB to linear to oklab with rounding at each
step. Perceptually uniform lightness is also exactly what an author is tuning
when hand-building a palette, and it is what Tailwind 4's own default palette
uses.

**Dropped from `COLOR_RE`:** `lab()` and `lch()`. These are CIE Lab, not Oklab,
and need the Lab to XYZ to Oklab chain: real work and real error surface for
notations nothing in the project uses. Advertising acceptance the engine cannot
back is precisely how the two-tier contrast bug arose, so the regex narrows
rather than half-supporting them.

A test asserts the two allowlists agree, so this class of drift cannot return.

Resolving arbitrary CSS colours through the browser's CSSOM was considered and
rejected: it works in a webview but is impure and jsdom does not compute
colours, which would break the pure-function testing model the refactor rests
on. The conversions stay in TypeScript.

Contrast enforcement therefore stops being conditional on notation. A theme
either gets the guarantee or gets a validation error naming the token. It never
receives silent second-class treatment.

## Validation and error surfacing

Validators are generated from each registry entry's `kind`.

Three changes, all aimed at the authoring loop:

1. **Collect all diagnostics, not the first.** `validateTheme` currently returns
   on the first bad key, making theme repair a whack-a-mole loop.
2. **Two severities.** *Errors* block loading (malformed colour, missing `id`).
   *Warnings* load fine but report something worth knowing: an unknown key, or a
   `textColor` that had to move a long way to clear its contrast floor. The
   latter is useful authoring feedback.
3. **Unknown keys stop being fatal.** Today an unrecognized colour key hard-fails
   the theme, so a theme using a token from a newer Terra will not load at all on
   an older build. As a warning, the theme still works and typos are still
   caught.

`sanitizeStoredThemes` today drops invalid stored themes silently, so a broken
theme simply vanishes with no explanation. It keeps rejecting them but carries
the diagnostics through so Settings can report which theme failed and why.

## Testing

The safety net is a **resolved-output snapshot**: because `resolveTheme` is
pure, every builtin crossed with every mode is snapshotted as its full variable
set. Compatibility is not required, but the snapshot diff is the review artifact
that shows exactly which values moved.

Four layers on top:

- **Registry invariants.** CSS var names unique, every `SyntaxRole` and
  `StatusRole` covered, `derive` graph acyclic. These make the
  single-source-of-truth claim true rather than aspirational.
- **Adversarial themes.** A theme with no `foreground`, one written entirely in
  `rgb()`, one setting only a seed. These are the two audit bugs, locked as
  permanent tests.
- **Contrast.** `syntaxLegibility` and `terminalLegibility` move to running over
  resolved output, so they cover custom themes rather than builtins only.
- **Creep guard.** A test asserting no `.tsx` file contains a literal alpha
  modifier on a theme token. Without it the 363 grow back the first time someone
  types `/60`.

Existing CSS-contract tests (`surfaceClasses.test.ts`, `tailwindTokens.test.ts`,
`codeHighlightTokens.test.ts`) are updated for the ladder.

## Rollout

Ordered so `main` stays green at every step:

1. Registry and `resolveTheme` land behind today's API. Snapshots prove parity.
2. `applyTheme` and `validateTheme` switch to reading the registry.
3. Emphasis ladder added, call sites migrated by codemod, creep guard added.
4. The two bug fixes, near-trivial by this point.
5. THEME.md token reference generated from the registry.
6. Old scattered tables deleted.

## Out of scope

- Seed-only authoring (full granularity was chosen deliberately).
- CSS-native derivation.
- Per-surface emphasis tokens.
- Theme schema versioning and migration.
