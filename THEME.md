# THEME.md

How to author a Terra theme. Read `TERRA.md` first for the wider architecture;
if this file conflicts with it, `TERRA.md` wins.

## The one rule

**A theme sets values and never ships CSS.** It fills CSS variables, picks an
icon set, and says whether it accepts the wallpaper. It never adds a selector,
a stylesheet, or a component change, so a theme cannot break on a component
refactor and a component refactor cannot silently drop a theme's identity.

The other half of the rule is on the components: **chrome reaches the theme
only through the scales and the label utility.** No `rounded-full`, no
`uppercase`, no arbitrary `rounded-[...]`, `shadow-[...]`, `blur-[...]`, or
`tracking-[...]`, no `border-solid`, no palette colour such as `bg-zinc-900`.
`src/app/theme-contract.test.ts` fails on any of them outside its allowlist,
and every allowlist entry names its reason. See ADR 0003.

## Where things live

| Path | What |
|---|---|
| `src/modules/theme/types.ts` | `Theme`, `ThemeVariant`, and the field types |
| `src/modules/theme/tokens.ts` | the token registry: key, CSS variable, derivation, fallback |
| `src/modules/theme/resolveTheme.ts` | authored value, else derived, else fallback |
| `src/modules/theme/applyTheme.ts` | writes the variables onto `<html>` |
| `src/modules/theme/themes/` | one file per builtin, registered in `index.ts` |
| `src/modules/theme/wallpaper.ts` | `wallpaperAllowed`, read by `SurfaceLayer` |
| `src/modules/explorer/lib/iconProvider.tsx` | the icon seam the `icons` field selects |
| `src/styles/globals.css` | defaults, the scale bridges, surface classes, `terra-label` |
| `src/app/theme-contract.test.ts` | the consumption contract |

Themes are TypeScript builtins only. The compiler checks the shape; the tests
below check the colours.

## Minimum viable theme

```ts
import type { Theme } from "../types";

export const myTheme: Theme = {
  id: "my-theme",              // kebab-case, unique, /^[a-z0-9][a-z0-9-]{1,63}$/
  name: "My Theme",
  description: "One line.",
  variants: {
    light: { colors: { /* ... */ }, terminal: { ansi: [/* 16 */] } },
    dark: { colors: { /* ... */ }, terminal: { ansi: [/* 16 */] } },
  },
};
```

Add it to `BUILTIN` in `themes/index.ts`; that order is the order in Settings.
**Define both variants and both ANSI palettes**; `builtins.test.ts` enforces
it. The editor derives its syntax palette from `ansi`, so a theme without one
falls back to a stock CodeMirror preset.

## What a theme can change

The whole app renders in the bundled JetBrainsMono Nerd Font (`src/assets/fonts`,
declared in `src/styles/fonts.css`); the terminal can switch to the bundled
FiraCode or CaskaydiaCove Nerd Font Mono, or to a system family, in Settings.
Themes do not pick a face, a weight, or a size; those are reading-comfort
choices, not identity.

| Identity | Field | Reaches |
|---|---|---|
| Palette | `colors.*` | every semantic utility (`bg-card`, `text-muted-foreground`, ...) |
| Corner shape | `colors.radius` | `rounded-xs` through `rounded-4xl`, proportionally |
| Pill shape | `shape.pillRadius` | every `rounded-pill` (chips, badges, toggles, thumbs) |
| Rule style | `colors.borderStyle` | every border, divider, and the window frame |
| Rule weight | `shape.frameWidth`, `chromeWidth`, `panelWidth`, `slotWidth` | the surface classes below |
| Bevel | `shape.bevel*` | three inset rings on frame, panel, slot |
| Label voice | `type.chromeTransform`, `type.chromeTracking` | every `terra-label` |
| Depth | `effects.shadow` | the tint of every `shadow-*`; `transparent` flattens |
| Glass | `effects.blur` | `on` keeps every `backdrop-blur-*`, `off` zeroes them |
| Wallpaper | `effects.wallpaper` | `false` declines the user's image |
| Icons | `icons` | `catppuccin` (colour SVGs) or `nerd` (font glyphs in the row colour) |
| Density | `shape.spacing` | every spacing utility; blunt, expect overflow |

Circles are geometry and never follow `pillRadius`: a status dot uses
`rounded-circle`. When you add a round element, ask "would this look wrong as a
square"; if yes it is a circle, otherwise it is a pill.

## Token reference

Every key is optional. Omitting one leaves the default, which is what renders
today. Regenerate this block with `pnpm theme:sync-tokens`;
`tokens.test.ts` fails when it drifts.

<!-- token-reference:start -->

### `colors`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `colors.background` | `--background` |  | App canvas. |
| `colors.foreground` | `--foreground` |  | Primary text on the canvas. |
| `colors.card` | `--card` |  | Raised surface. Falls back to the canvas. |
| `colors.cardForeground` | `--card-foreground` |  | Text on card surfaces. |
| `colors.popover` | `--popover` |  | Popover surface. |
| `colors.popoverForeground` | `--popover-foreground` |  | Text on popover surfaces. |
| `colors.primary` | `--primary` |  | Primary accent color. |
| `colors.primaryForeground` | `--primary-foreground` |  | Text on primary color. |
| `colors.secondary` | `--secondary` |  | Secondary accent color. |
| `colors.secondaryForeground` | `--secondary-foreground` |  | Text on secondary color. |
| `colors.muted` | `--muted` |  | Muted surface. |
| `colors.mutedForeground` | `--muted-foreground` |  | Text on muted surfaces. |
| `colors.accent` | `--accent` |  | Accent color. |
| `colors.accentForeground` | `--accent-foreground` |  | Text on accent color. |
| `colors.destructive` | `--destructive` |  | Destructive action color. |
| `colors.border` | `--border` |  | Default border color. |
| `colors.input` | `--input` |  | Input border color. |
| `colors.ring` | `--ring` |  | Focus ring color. |
| `colors.radius` | `--radius` |  | Border radius. |
| `colors.borderStyle` | `--border-style` |  | Border style. |

### `shape`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `shape.frameWidth` | `--frame-border-width` | `1px` | Frame border width. |
| `shape.frameRadius` | `--frame-radius` | `12px` | Frame border radius. |
| `shape.framePadding` | `--frame-padding` | `0px` | Frame padding. |
| `shape.chromeWidth` | `--chrome-border-width` | `1px` | Chrome border width. |
| `shape.panelWidth` | `--panel-border-width` | `1px` | Panel border width. |
| `shape.slotWidth` | `--slot-border-width` | `1px` | Slot border width. |
| `shape.bevelWidth` | `--bevel-width` | `0px` | Bevel width. |
| `shape.bevelOuter` | `--bevel-outer` | `transparent` | Bevel outer color. |
| `shape.bevelMid` | `--bevel-mid` | `transparent` | Bevel mid color. |
| `shape.bevelInner` | `--bevel-inner` | `transparent` | Bevel inner color. |
| `shape.spacing` | `--ui-spacing` | `0.25rem` | UI spacing. |
| `shape.pillRadius` | `--radius-pill` | `9999px` | Radius of pills, chips, toggles, and badges (rounded-pill). |

### `type`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `type.chromeTracking` | `--chrome-tracking` |  | Chrome letter spacing. |
| `type.chromeTransform` | `--chrome-transform` |  | Chrome text transform. |

### `effects`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `effects.shadow` | `--fx-shadow-color` |  | Tint every shadow utility uses; transparent flattens the app. |
| `effects.blur` | `--fx-blur-factor` | `1` | Backdrop blur: on keeps the scale, off zeroes it. |

### `terminal`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `terminal.background` | `--terminal-background` |  | Terminal background. |
| `terminal.foreground` | `--terminal-foreground` |  | Terminal foreground. |
| `terminal.cursor` | `--terminal-cursor` |  | Terminal cursor. |
| `terminal.cursorAccent` | `--terminal-cursor-accent` |  | Terminal cursor accent. |
| `terminal.selection` | `--terminal-selection` |  | Terminal selection. |
| `terminal.ansiBlack` | `--terminal-ansi-black` |  | ANSI Black. |
| `terminal.ansiRed` | `--terminal-ansi-red` |  | ANSI Red. |
| `terminal.ansiGreen` | `--terminal-ansi-green` |  | ANSI Green. |
| `terminal.ansiYellow` | `--terminal-ansi-yellow` |  | ANSI Yellow. |
| `terminal.ansiBlue` | `--terminal-ansi-blue` |  | ANSI Blue. |
| `terminal.ansiMagenta` | `--terminal-ansi-magenta` |  | ANSI Magenta. |
| `terminal.ansiCyan` | `--terminal-ansi-cyan` |  | ANSI Cyan. |
| `terminal.ansiWhite` | `--terminal-ansi-white` |  | ANSI White. |
| `terminal.ansiBrightBlack` | `--terminal-ansi-bright-black` |  | ANSI Bright Black. |
| `terminal.ansiBrightRed` | `--terminal-ansi-bright-red` |  | ANSI Bright Red. |
| `terminal.ansiBrightGreen` | `--terminal-ansi-bright-green` |  | ANSI Bright Green. |
| `terminal.ansiBrightYellow` | `--terminal-ansi-bright-yellow` |  | ANSI Bright Yellow. |
| `terminal.ansiBrightBlue` | `--terminal-ansi-bright-blue` |  | ANSI Bright Blue. |
| `terminal.ansiBrightMagenta` | `--terminal-ansi-bright-magenta` |  | ANSI Bright Magenta. |
| `terminal.ansiBrightCyan` | `--terminal-ansi-bright-cyan` |  | ANSI Bright Cyan. |
| `terminal.ansiBrightWhite` | `--terminal-ansi-bright-white` |  | ANSI Bright White. |

### `syntax`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `syntax.comment` | `--syntax-comment` |  | Comment color. |
| `syntax.keyword` | `--syntax-keyword` |  | Keyword color. |
| `syntax.string` | `--syntax-string` |  | String color. |
| `syntax.number` | `--syntax-number` |  | Number color. |
| `syntax.constant` | `--syntax-constant` |  | Constant color. |
| `syntax.func` | `--syntax-func` |  | Function color. |
| `syntax.variable` | `--syntax-variable` |  | Variable color. |
| `syntax.property` | `--syntax-property` |  | Property color. |
| `syntax.gutterFg` | `--syntax-gutter-fg` |  | Gutter foreground color. |
| `syntax.type` | `--syntax-type` |  | Type color. |
| `syntax.operator` | `--syntax-operator` |  | Operator color. |
| `syntax.tag` | `--syntax-tag` |  | Tag color. |
| `syntax.tagBracket` | `--syntax-tag-bracket` |  | Tag bracket color. |
| `syntax.attr` | `--syntax-attr` |  | Attribute color. |
| `syntax.attrValue` | `--syntax-attr-value` |  | Attribute value color. |
| `syntax.heading` | `--syntax-heading` |  | Heading color. |
| `syntax.link` | `--syntax-link` |  | Link color. |
| `syntax.invalid` | `--syntax-invalid` |  | Invalid token color. |

### `status`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `status.added` | `--status-added` |  | Added status color. |
| `status.modified` | `--status-modified` |  | Modified status color. |
| `status.deleted` | `--status-deleted` |  | Deleted status color. |
| `status.renamed` | `--status-renamed` |  | Renamed status color. |
| `status.warning` | `--status-warning` |  | Warning status color. |
| `status.conflict` | `--status-conflict` |  | Conflict status color. |
| `status.ok` | `--status-ok` |  | OK status color. |

### `emphasis`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `emphasis.faint` | `--emph-faint` | `10%` | Faint emphasis. |
| `emphasis.subtle` | `--emph-subtle` | `30%` | Subtle emphasis. |
| `emphasis.soft` | `--emph-soft` | `40%` | Soft emphasis. |
| `emphasis.medium` | `--emph-medium` | `50%` | Medium emphasis. |
| `emphasis.strong` | `--emph-strong` | `60%` | Strong emphasis. |
| `emphasis.bold` | `--emph-bold` | `85%` | Bold emphasis. |

<!-- token-reference:end -->

## Terminal palette

`terminal.ansi` is exactly 16 strings in the standard order:

```
0-7   black red green yellow blue magenta cyan white
8-15  the same eight, bright
```

Rules `terminalLegibility.test.ts` enforces on every builtin:

- No slot may equal the background.
- Blue must differ from cyan, in both rows.
- `foreground` against `background` clears 4.5:1.
- Normal slots 1-7 clear 4.5:1; bright slots 9-15 clear 3:1.
- Slot 8 (`brightBlack`, the comment colour) clears 3:1.
- Slot 0 is exempt from the ratio, not from the equality rule.

Omitting `terminal.background` inherits `colors.background`, so a saturated
canvas becomes a saturated terminal. Keep terminal backgrounds under about 25%
saturation. When a slot has to move, move it with `ensureContrast` from
`oklab.ts`: it walks lightness only, so hue and chroma survive.

## Derived syntax and status colours

`syntax` and `status` derive from `ansi`, lightness-normalized against
`colors.background` (4.5:1, or 3:1 for `comment`, `gutterFg`, `tagBracket`);
status roles are normalized against `card` as well. Declare a role only to pin
it. `resolveTheme.test.ts` asserts every derived value clears its floor on
every builtin. Slots: `comment` 8, `keyword` 5, `string` 2, `number` 3,
`constant` 13, `func` 4, `property` 6, `type` 14, `tag` 1, `attr` 11,
`attrValue` 2, `heading` 4, `link` 6, `invalid` 9, `gutterFg` and
`tagBracket` 8, `variable` and `operator` from `foreground`. Status: `added` 2,
`modified` 3, `deleted` 1, `renamed` 4, `warning` 3, `conflict` 6, `ok` 2.

## Surface classes and the label utility

| Class | Applied to | Reads |
|---|---|---|
| `.terra-frame` | app root | `frameWidth`, `framePadding`, bevel rings |
| `.terra-chrome` | header, statusbar, explorer header | `chromeWidth` |
| `.terra-panel` | explorer | `panelWidth`, bevel rings |
| `.terra-slot` | nothing yet | `slotWidth`, one inner ring |
| `terra-label` | tab titles, rail labels, statusbar chips, panel and menu headings, settings navigation | `chromeTracking`, `chromeTransform` |

Surface classes live in `@layer components`, so a component's own utilities
still win. `--surface-border-width` is registered `inherits: false`; without
that a class on the header would thicken every button inside it. `terra-label`
is a utility so variants can target it (`**:[[cmdk-group-heading]]:terra-label`).
Its two properties inherit, so it goes on the chrome element and reaches every
text node inside; a nested `normal-case tracking-normal` resets a child that is
content. Content never wears it: file names, commit messages, diff text,
terminal, editor, toasts, the breadcrumb path.

The bevel is three stacked inset rings at `bevelWidth`, `2 * bevelWidth`, and
`3 * bevelWidth`; `bevelWidth: "4px"` with three opaque colours paints 12px.

## Design guidance

- Separate surfaces with borders, not value jumps; a themed palette reads better
  when surfaces stay close and the rule does the work.
- `radius: "0rem"` wants `frameRadius: "0px"` and `pillRadius: "2px"` or the
  app is square panels inside a round window with round chips.
- A dotted rule needs 2px and a border colour that clears 3:1; at 1px CSS
  dotted is indistinguishable from a faint solid line. Raise `emphasis.strong`
  so the chrome does not draw that rule at 60% alpha.
- A thick `frameWidth` needs `framePadding`.
- Turning `effects.shadow` transparent removes depth cues; pair it with a
  visible `border` and a `borderStyle` that carries texture.

## Before you ship

```
pnpm test            # builtins, legibility, resolveTheme floors, theme contract
pnpm check-types
pnpm lint
```

- [ ] Both variants, both `ansi` palettes, same colour keys in each
- [ ] Registered in `themes/index.ts`
- [ ] Terminal rules above pass
- [ ] `mutedForeground` clears 4.5:1 against `card` and `background`
- [ ] Looked at it running in both modes, with a menu, a dropdown, the
      command palette, the source control panel, and an editor tab open

## Adding a token

1. `types.ts`: add the key to its field type.
2. `tokens.ts`: add the entry (key, `cssVar`, group, kind, `fallback` or
   `derive`, and `map` for a keyword that becomes a different CSS value).
3. `globals.css`: consume it with `var(--x, <today's value>)` so a theme that
   does not set it renders byte-identical.
4. Tests: `tokens.test.ts` and `surfaceClasses.test.ts` or
   `tailwindTokens.test.ts` assert the mapping and the default.
5. `pnpm theme:sync-tokens`.

A field that is not a CSS variable (`icons`, `effects.wallpaper`) lives on the
variant type and is read by its consumer through `useTheme().activeVariant`.
