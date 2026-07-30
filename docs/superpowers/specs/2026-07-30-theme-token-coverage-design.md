# Theme Token Coverage (Design)

**Goal:** Close the gap between "a theme colours the shell" and "a theme colours the app" by deriving syntax and status colours from the ANSI palette a theme already declares, with byte-identical rendering for any theme that does not derive.

---

## Problem

An audit of the theme engine found the architecture sound: 68 CSS variables written from declarative theme data, `ALL_VARS` derived from the name-to-variable maps so `clearTheme()` self-maintains, and every consumer carrying a `var(--x, <today's value>)` fallback. Component adoption is already high, roughly 766 semantic-token utility uses against 49 hardcoded palette sites in 10 files.

The engine is not the constraint. Coverage is. Two colour systems the UI depends on are unreachable from a theme.

### Syntax highlighting is a closed set

A theme can only *name* one of 22 hardcoded CodeMirror themes through `editorTheme` (`src/modules/settings/store.ts:11-34`). It cannot express syntax colours at all. The consequence is visible today: `nothing`, a monochrome palette with a single red accent, pairs with `kanagawa` (`src/modules/theme/themes/nothing.ts:8-11`), so its editor renders in warm purples and greens that appear nowhere else in the theme.

There is a third syntax palette beyond those two. `src/styles/code-highlight.css` defines 34 `--tok-*` variables (17 roles across a light and a dark block) with fixed oklch values, driving code blocks in markdown preview. It covers the same concepts as the CodeMirror palette, uses a different token set, and is also unreachable. A themed editor beside an unthemed preview pane is the incoherence this work removes.

### No semantic status tokens

Git status and diagnostic colours are hardcoded Tailwind palette values. `src/modules/explorer/lib/gitStatusColor.ts:5-15` is the clearest case:

```ts
case "M": return "text-amber-700 dark:text-amber-300";
case "A":
case "U": return "text-emerald-700 dark:text-[#73C991]";
```

The same pattern appears in `GitDiffPane`, `SourceControlPanel`, `GitHistoryPane`, `DiagnosticsBadge`, `StatusBar`, and `LspStatusPill`. Every theme, however carefully authored, renders VS Code's green, amber and rose for diffs and diagnostics.

### The opening

Every serious theme already declares 16 ANSI colours, and syntax palettes are conventionally drawn from the same hues. This is how base16 works: kanagawa's ANSI red *is* its syntax red. Git status maps onto ANSI just as directly, with added, modified and deleted sitting on green, yellow and red.

So the colours needed already exist inside every theme file. Nothing needs authoring. They just need deriving.

---

## Scope

In scope:

- Syntax palette derived from ANSI, with an optional explicit override
- Seven semantic status tokens, same derivation and override
- `--tok-*` driven from the same source
- `starterTheme()` emitting both variants
- `SHAPE_COLOR_KEYS` validation
- TERRA.md's stale built-in list

Deferred to their own spec and plan cycles, because both are large mechanical migrations with visual-regression risk that does not belong mixed into token work:

- The 323 opacity-modified themeable colour sites (`border-border/60` and similar) that dilute authored values
- Finishing `.terra-slot` and `.terra-control` adoption, which `2026-07-27-themable-surfaces-design.md:152-153` specified but never landed

Also left alone deliberately: `SourceControlPanel.tsx:102`, which hardcodes `bg-zinc-950 text-zinc-100` for a tooltip and repeats it under `dark:`. That duplication reads as a deliberate choice to keep the tooltip dark in both modes, the way VS Code does, so changing it is a design decision rather than a token fix. It stays hardcoded and is noted as a follow-up.

Also deferred: making the 22-theme CodeMirror registry lazy per id. Approach A means most users never need any of the 9 external `@uiw/codemirror-theme-*` packages, so there is a real bundle win, but it is an independent change.

## Non-goals

- **Terminal colour.** Already fully themable. No work needed.
- **Removing the 22 curated CodeMirror themes.** They stay explicitly selectable. Derivation changes what `auto` means, not what a user can pick.
- **Font or shape tokens.** Untouched.

---

## Architecture

### Three pure modules

New modules under `src/modules/theme/`:

```ts
// oklab.ts
ensureContrast(color, bg, minRatio) → string

// derive.ts
syntaxFromAnsi(terminal, colors, override) → SyntaxPalette | null
statusFromAnsi(terminal, colors, override) → StatusTokens  | null
```

The derivation functions return `null` when `terminal.ansi` is absent. That `null` is the signal that drives precedence fall-through, not an error. No side effects, no DOM access, fully unit-testable, which keeps the logic in the functional core and `applyTheme` a thin imperative shell.

`types.ts` gains `syntax?: Partial<SyntaxPalette>` and `status?: Partial<StatusTokens>` on `ThemeVariant`. Both are partial, so an override supplies only the keys it cares about and derivation fills the rest. The merge happens inside the pure function, not at the call site.

### Lightness normalization is required, not optional

Raw ANSI cannot be used directly. Measured across all 11 derivable built-ins, a 4.5:1 floor against `colors.background` fails for 9 of them, and a 3:1 floor still fails for 7. The codebase already knows why: `terminalLegibility.test.ts:75-77` records that Stardew "is authored to a contrast budget rather than transcribed from an upstream palette, so it is the one theme that can hold the numeric floor." Transcribed upstream palettes do not hold a numeric floor against an app surface.

`ensureContrast` fixes this by moving **lightness only** in OKLab, preserving the `a` and `b` components so hue and chroma survive. It binary-searches L for 14 iterations toward whichever direction the background requires.

An earlier approach, blending the colour toward the theme's `foreground`, also converged but destroyed the palette:

| Role | blend toward fg | OKLab lightness only |
|---|---|---|
| everforest `string` | `#8da101` to `#677658` | `#8da101` to `#687900` |
| everforest `property` | `#35a77c` to `#537874` | `#35a77c` to `#008159` |
| nord `number` | `#ebcb8b` to `#746c5c` | `#ebcb8b` to `#866829` |

The left column is mud. The right column is what a designer would pick.

Floors, matching THEME.md's existing tiering for slot 8: **3:1** for the three dim roles (`comment`, `gutterFg`, `tagBracket`) and **4.5:1** for the other 15. Status tokens clear 4.5:1 against `background` and `card` both, applied as two sequential passes, which converges because both surfaces are always the same polarity within a variant.

Measured outcome: zero failures across all 22 theme and mode combinations. `stardew` and `kanagawa-dragon` need zero adjustments in either mode, which is the independent confirmation that the floors are set correctly rather than tuned to pass.

### The mapping

| Role | ANSI slot | Role | ANSI slot |
|---|---|---|---|
| `comment` | 8 brightBlack | `type` | 14 brightCyan |
| `keyword` | 5 magenta | `operator` | foreground |
| `string` | 2 green | `tag` | 1 red |
| `number` | 3 yellow | `tagBracket` | 8 brightBlack |
| `constant` | 13 brightMagenta | `attr` | 11 brightYellow |
| `func` | 4 blue | `attrValue` | 2 green |
| `variable` | foreground | `heading` | 4 blue |
| `property` | 6 cyan | `link` | 6 cyan |
| `gutterFg` | 8 brightBlack | `invalid` | 9 brightRed |

`foreground` resolves as `terminal.foreground ?? colors.foreground`.

Status, seven tokens: `added` to 2, `modified` to 3, `deleted` to 1, `renamed` to 4, `warning` to 3, `conflict` to 6, `ok` to 2. Error keeps the existing `destructive` token, which `DiagnosticsBadge.tsx:18` already uses.

The set changed from the six originally sketched, on evidence from enumerating every consumer:

- **`info` dropped.** `DiagnosticsBadge.tsx` renders only errors and warnings. No surface consumes an info or hint colour, so the token would have no consumer. YAGNI.
- **`conflict` added.** `SourceControlPanel.tsx:142` gives status `U` its own teal, distinct from the emerald it uses for `A`. Without a token that distinction cannot survive.
- **`ok` added.** `LspStatusPill.tsx:245` and `LspServersGroup.tsx:86` both hardcode `bg-emerald-500` for a health dot. That is a status, and it is not "added".

Some roles collide by design. `attrValue` and `string` both land on green, `heading` and `func` both on blue, `modified` shares a hue with `warning`, and `ok` shares one with `added`. Each pair occupies a disjoint context, so the two members never render adjacent, and the override exists for an author who wants them distinct.

`explorer/lib/gitStatusColor.ts:8-9` groups `A` and `U` on one colour while `SourceControlPanel` separates them. That disagreement is preserved rather than fixed here: the explorer keeps mapping both to `added`, so this work changes no semantics. Reconciling them is a follow-up.

`cmThemes.ts:6-8` records that `background`, `selection` and `caret` from a CodeMirror palette are overridden by `buildSharedExtensions()`, and `chromeTheme.ts` confirms it by owning those properties through `var(--)` already. So the derived palette carries syntax roles only. It does not need to express surfaces.

### Data flow

```
Theme.variants[mode]
  ├ terminal.ansi ──┬→ syntaxFromAnsi ─┐
  │                 └→ statusFromAnsi ─┤
  ├ syntax? (override) ───── merge ────┤
  └ status? (override) ───── merge ────┘
                                       ↓
                        resolveThemeVars → ThemeVar[]
                                       ↓
                             applyTheme → <html>.style
                          ├─ --syntax-*  → static CM theme + --tok-*
                          └─ --status-*  → text-status-* utilities
```

### Precedence

For the `auto` editor preference:

```
syntax block (author override)
   ↓ absent
derive from terminal.ansi
   ↓ no ansi
editorTheme pairing
   ↓ absent
FALLBACK[mode]
```

Derivation outranks `editorTheme` deliberately. All 12 built-ins declare an `editorTheme`, so if the pairing won, none of them would improve without also editing every file, and the work would ship infrastructure with no visible effect. `editorTheme` becomes the escape hatch for an author who genuinely wants github-dark.

An explicit editor-theme preference other than `auto` always wins over all of this. Derivation only ever changes what `auto` resolves to.

### Resulting behaviour per built-in

| Theme | Derived syntax and status |
|---|---|
| kanagawa, everforest, gruvbox, nord, caffeine, sage, tide, stardew, nothing | both modes |
| kanagawa-dragon, tokyo-night | dark only, single-variant themes that already fall back across modes |
| terra-default | none. Zero ANSI blocks, so it resolves to `atomone` exactly as today |

`terra-default` is also the theme `ThemeProvider.tsx:139-142` short-circuits through `clearTheme()`, so it writes no variables at all and the `globals.css` defaults apply untouched.

---

## Components

### `resolveVariant.ts`

A new shared primitive, because `applyTheme` and `resolveEditorTheme` must agree on which variant won:

```ts
resolveVariant(theme, mode) → { variant: ThemeVariant; mode: ThemeMode } | null
```

It reproduces the existing `mode ?? dark ?? light` precedence from `applyTheme.ts:95-96` but also reports **which** mode actually supplied the variant.

That second return field fixes a latent bug this work would otherwise introduce. A dark-only theme such as tokyo-night viewed in light mode falls back to its dark variant, so the derived syntax vars hold dark colours. If the editor picked its extension from the *requested* mode it would mount the light CodeMirror frame around dark syntax colours. Because the whole app is already showing that theme's dark surfaces in this situation, the correct extension is the dark one, and `resolveVariant` is what makes both call sites reach that conclusion from the same logic.

### `applyTheme.ts`

Gains `SYNTAX_VAR` and `STATUS_VAR` maps alongside the existing three. Derivation is called inside `resolveThemeVars`, which is already the pure, exported and tested function that produces `ThemeVar[]`. Two consequences worth stating: `applyTheme` stays a DOM writer with no new logic, and `ALL_VARS` picks up the new names automatically from `Object.values`, so `clearTheme()` keeps working with no edit.

### `globals.css`

Seven `@theme inline` entries so Tailwind generates the utilities:

```css
--color-status-added: var(--status-added);
```

That yields `text-status-added`, `bg-status-added` and `border-status-added`, so consumers use the same utility grammar as every other colour in the app.

`:root` and `.dark` gain `--status-*` defaults, taken verbatim from `node_modules/tailwindcss/theme.css` so they match the utilities they replace exactly.

One token cannot reproduce today's rendering exactly, because today is not consistent. "Added" is emerald-700 in the explorer, emerald-600 in git history and the diff pane, and emerald-500 at 85% in the source-control dot. Consolidating three shades into one token necessarily moves some sites.

The rule applied: **pick the shade that maximizes text legibility**, since text is the dominant use and a status dot stays visible at any of these shades. That means the darker shade for light mode and the lighter shade for dark mode. Concretely, light mode takes the 700 shades and dark mode the 300 or 400 shades, which preserves the majority of sites and improves the rest. `ok` keeps emerald-500 in both modes, matching its only two consumers exactly.

No `--syntax-*` defaults are added. When a theme cannot derive, the editor takes the preset path, so the var-driven theme is never active without values behind it. Adding defaults would imply a functional path that does not exist.

### `code-highlight.css`

Each of the 17 roles in both blocks becomes `var(--syntax-<role>, <today's oklch>)`. The fallback is inline, so the light and dark blocks each keep their own current value and an underived theme renders byte-identically. Role mapping: `tok-name` to `variable`, `tok-bool` to `constant`, `tok-regexp` to `string`, `tok-meta` to `comment`, `tok-punctuation` to `operator`, and the remaining twelve one-to-one.

### `cmThemes.ts`

Gains two extensions built once at module load, one per mode, with every colour expressed as `var(--syntax-keyword)` rather than a literal. CodeMirror bakes `dark` into a theme, which is why there are two rather than one.

The `Palette` type has 25 fields; 18 are syntax roles and become `--syntax-*` tokens. The remaining seven are surfaces and flags that `chromeTheme.ts` already owns or that need no token: `bg`, `selection`, `caret` and `lineHighlight` resolve to `transparent` because `buildSharedExtensions()` overrides them, `fg` reads the existing `var(--foreground)` rather than adding a duplicate token, `mode` is the per-mode split itself, and `boldKeyword` stays off.

### `resolveEditorTheme.ts`

Returns a discriminated result instead of a bare id:

```ts
type EditorThemeResolution =
  | { kind: "derived"; mode: "light" | "dark" }
  | { kind: "preset"; id: EditorThemeId };
```

`useEditorThemeExt` maps `derived` to the static per-mode var theme and `preset` to the existing `EDITOR_THEME_EXT` registry.

**This is where the performance property lands.** For a derived theme, switching app themes returns the same extension identity, so the `useMemo` in `useEditorThemeExt.ts:11-14` holds and CodeMirror never reconfigures. Only the CSS variables change. Today an app-theme switch changes extension identity and every mounted editor pane reconfigures, recompiling its `HighlightStyle` and re-rendering visible decorations, and TERRA.md is explicit that editor tabs stay mounted rather than unmounting on switch. Only a light-to-dark flip swaps the extension now, which is correct and rare.

### Consumers

The 49 sites across 10 files move to the new utilities. These call sites get simpler, not more complex, because the variable already differs per mode and the `dark:` variant disappears:

```ts
case "M": return "text-status-modified";
```

---

## Error handling

- Absent `terminal.ansi` returns `null`, the ordinary fall-through signal.
- `validateTheme` gains `parseSyntax` and `parseStatus` with key allowlists, matching `parseColors`. An unknown key hard-rejects the theme, consistent with existing behaviour.
- Override values pass through to CSS as colours already do. This is safe here in a way it is not for `bevelOuter`, because syntax and status values never compose into a shared `box-shadow`, so a bad value degrades one token instead of silently killing four.

---

## Testing

Tests come before implementation for both pure functions.

**`syntaxFromAnsi.test.ts` and `statusFromAnsi.test.ts`.** Table-driven across all 18 and 6 roles. Returns `null` when `ansi` is absent. A partial override replaces only its own keys and leaves the rest derived. `variable` and `operator` resolve `terminal.foreground ?? colors.foreground`.

**`oklab.test.ts`.** Round-trips hex through OKLab within a 1/255 tolerance. `ensureContrast` returns the input unchanged when it already clears the floor, and otherwise returns a colour meeting the floor whose OKLab `a` and `b` are unchanged within floating-point tolerance. That last assertion is the one that guarantees hue and chroma survive, which is the whole reason for choosing lightness-only over blending.

**`syntaxLegibility.test.ts`.** For every built-in with derivable ANSI, each derived syntax role clears its floor against `colors.background`, not against the terminal background. That distinction matters because ANSI is tuned against the terminal surface while the editor renders as glass over the app surface. Status tokens are checked against `background`, where the explorer draws them, and `card`, where the source-control panel does.

This test passes by construction, because `ensureContrast` enforces the floors it asserts. It is a regression guard on the derivation, not a discovery mechanism. Its value is that it fails loudly if the mapping table, the floors, or the OKLab math regress. It also asserts that `stardew` and `kanagawa-dragon` require zero adjustment, pinning the property that made the floors trustworthy in the first place.

Themes whose `colors.background` is not plain hex are skipped, following the defensive `return null` pattern `palette()` already uses in `terminalLegibility.test.ts:35-39`.

The contrast helper in `terminalLegibility.test.ts:5-31` is hex-only and test-local. It moves into `oklab.ts` as production code so both suites and the derivation share one implementation.

**Extensions to existing suites.** `applyTheme.test.ts`: new variables written, and present in `ALL_VARS` so `clearTheme` removes them. `validateTheme.test.ts`: unknown syntax or status key rejected, partial override accepted. `resolveEditorTheme.test.ts`: the full precedence chain, including tokyo-night resolving to the *dark* derived extension in light mode, because `resolveVariant` reports that its dark variant is the one that supplied the colours. `tailwindTokens.test.ts`: the seven new `@theme inline` entries.

**Manual verification.** The tests catch dead and illegible colours but cannot say whether the result looks good. Requires looking at kanagawa, nothing and stardew running, with an editor and a markdown preview side by side.

---

## Small fixes

Three items from the audit that live in the same files.

1. **`themeFiles.ts:74-114`.** `starterTheme()` emits only a `dark` variant, the exact pattern THEME.md forbids and `builtins.test.ts` enforces against for built-ins, so a user in light mode gets the dark palette. It emits both variants, and gains an ANSI block so a new theme gets derived syntax and status immediately. This fixes the bug and demonstrates the feature in the one file every theme author starts from.

2. **`validateTheme.ts:43-45`.** `SHAPE_COLOR_KEYS` receive no validation, yet they compose into a shared `box-shadow`, so one invalid value silently kills all three bevel rings and the lift. Lengths are already regex-checked for exactly this reason. They gain a colour-form check: `transparent`, `#hex`, or a bounded `rgb|rgba|hsl|hsla|oklch|oklab|lab|lch(...)` call, rejecting `;`, `{` and `}` so a value cannot break out of the declaration.

3. **Docs.** TERRA.md's built-in list names claude, catppuccin, rose-pine, dracula and solarized, none of which exist since commit `140c64f` removed them. Corrected to the actual 12. THEME.md gains a `syntax` and `status` section, the derivation table, the precedence chain, and the new keys in its "Adding a token" checklist.

---

## Verification

```
pnpm test
pnpm check-types
pnpm lint
```

Success criteria:

- Every built-in with ANSI derives syntax and status in both modes, except the two grandfathered single-variant themes
- `terra-default` renders byte-identically, verified by the existing default assertions
- An app-theme switch performs no CodeMirror reconfiguration for a derived theme
- Markdown preview code blocks and the editor show the same palette
- No theme file needs editing for the feature to take effect, only for an override
