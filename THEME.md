# THEME.md

How to author a Terra theme. Read `TERRA.md` first for the wider architecture; if
this file conflicts with it, `TERRA.md` wins.

## The one rule

**A theme sets CSS variables and nothing else.** It never ships a selector, a
stylesheet, or a component change. This is not a style preference, it is the
security boundary: a theme file can be imported from anywhere, and a theme that
could write CSS could hide the UI, cover the window, or exfiltrate through
`url()`. It also means themes never break on a component refactor.

The consequence you have to design around: **a theme can only reach a property
that Tailwind compiled into a `var()`.** If a look needs something no variable
controls yet, the fix is to add a token to the engine (see "Adding a token"),
not to add CSS to the theme.

## Where things live

| Path | What |
|---|---|
| `src/modules/theme/types.ts` | `Theme`, `ThemeColors`, `TerminalPalette`, `ThemeShape`, `ThemeTypography` |
| `src/modules/theme/applyTheme.ts` | token name to CSS variable maps; writes them to `<html>` |
| `src/modules/theme/validateTheme.ts` | allowlist for user-supplied themes |
| `src/modules/theme/themes/` | one file per built-in, re-exported from `index.ts` |
| `src/modules/theme/fonts.ts` | registry of bundled fonts a theme may name |
| `src/modules/theme/resolveTerminalFont.ts` | folds a theme's terminal font into the user's preferences |
| `src/styles/globals.css` | variable defaults and the `.terra-*` surface classes |

Built-in themes are TypeScript objects and **skip validation**. User themes
(`.terra-theme` JSON in `appConfigDir()/themes`, or the custom-theme store) go
through `validateTheme`, which hard-rejects unknown keys. Adding a token means
adding it to the allowlist too, or user themes using it fail to load entirely.

## Minimum viable theme

```ts
import type { Theme } from "../types";

export const myTheme: Theme = {
  id: "my-theme",              // kebab-case, unique, matches /^[a-z0-9][a-z0-9-]{1,63}$/
  name: "My Theme",
  description: "One line.",
  editorTheme: { light: "github-light", dark: "kanagawa" },
  variants: {
    light: { colors: { /* ... */ } },
    dark: { colors: { /* ... */ } },
  },
};
```

Then add it to `BUILTIN` in `themes/index.ts`. Order in that array is the order
users see in Settings.

**Always define both variants.** `builtins.test.ts` enforces it for newer themes
and will enforce it for yours. A theme with only one variant silently falls back
across modes, so a user in dark mode gets your light palette.

## Token reference

Every key is optional. Omitting one leaves the current default, which is always
the value that renders today.

### `colors` (variant-level)

Maps 1:1 onto the shadcn variable set: `background`, `foreground`, `card`,
`cardForeground`, `popover`, `popoverForeground`, `primary`, `primaryForeground`,
`secondary`, `secondaryForeground`, `muted`, `mutedForeground`, `accent`,
`accentForeground`, `destructive`, `border`, `input`, `ring`, and the eight
`sidebar*` keys. Plus two that are not colors but live here for historical
reasons:

- `radius` - a CSS length, e.g. `"0.625rem"`. Drives `rounded-sm` through
  `rounded-4xl` proportionally. `rounded-full` (36 sites) and `rounded-none`
  bypass it by design.
- `borderStyle` - one of `solid`, `dashed`, `dotted`, `double`, `none`. Changes
  the stroke of borders that already have a width; it never draws one.

Values are passed through to CSS untouched, so any valid colour syntax works
(`#rrggbb`, `oklch(...)`, `rgba(...)`).

**Surfaces that actually carry the UI:** `background` is the app canvas,
`card` is the header, statusbar and side-panel container, `popover` is menus and
dropdowns. Note that **`bg-sidebar` has zero usages** - the eight `sidebar*`
tokens are currently inert. Set them coherently anyway so the theme stays
correct if the sidebar primitive is adopted, but do not rely on them for a look.

### `terminal` (variant-level)

Colour keys are `background`, `foreground`, `cursor`, `cursorAccent`,
`selection`, and `ansi`: exactly 16 strings in the standard order. The three
optional font keys are covered under [Terminal font](#terminal-font) below.

```
0-7   black red green yellow blue magenta cyan white
8-15  the same eight, bright
```

Rules that `terminalLegibility.test.ts` enforces across every built-in:

- **No slot may equal the background.** Stardew once shipped
  `brightWhite === background`, which is invisible text, not a colour choice.
  Canonical Gruvbox light does the same thing in slot 0.
- **Blue must differ from cyan**, in both the normal and bright rows.
- **`foreground` vs `background` must clear 4.5:1.**
- Normal slots 1-7 clear **4.5:1** against your background.
- Bright slots 9-15 clear **3:1**.
- **Slot 8 (`brightBlack`) clears 3:1.** This is the one everyone gets wrong: it
  is the comment colour in most tooling, and a "subtle" value lands at 1.6:1 and
  makes every comment unreadable.
- Slot 0 (`black`) is exempt from the ratio, but not from the equality rule. It
  is legitimately near-background on dark themes.

**Omitting `terminal.background` does not opt you out.** The test falls back to
`colors.background` and `colors.foreground`, matching what the engine does via
`--terminal-background: var(--background)`. It used to skip any variant that
left those keys undeclared, which is how three built-ins shipped unmeasured.
The corollary is that an undeclared terminal background inherits the canvas, so
a saturated canvas becomes a saturated terminal background: declare one.

When a value has to move to clear a floor, move it with `ensureContrast` from
`oklab.ts` rather than by eye. It walks OKLab lightness only, so hue and chroma
survive and a canonical palette stays recognizable.

**Keep the terminal background desaturated.** Well-regarded terminal palettes sit
at 5-25% HSL saturation (gruvbox-hard `#1d2021` is 6%, kanagawa `#1f1f28` is 15%,
rose-pine `#191724` is 19%). Above roughly 30% the background stops being a tint
and becomes a colour, and it visibly pushes its hue into every slot drawn on it.
Pick your hue from the theme, then pull saturation down.

### Terminal font

A theme may also declare the terminal font. These three are optional and sit
alongside the colour keys in `terminal`:

| Key | Type | Accepted values |
|---|---|---|
| `fontFamily` | string | any non-empty family string |
| `fontWeight` | string | `normal`, `bold`, or `100`-`900` in hundreds |
| `fontSize` | number | integer from 8 to 32 |

**A theme font is a default, not an override.** `resolveTerminalFont` compares
each preference against its shipped default (`terminalFontFamily` is `""`,
`terminalFontWeight` is `normal`, `terminalFontSize` is
`TERMINAL_FONT_SIZE_DEFAULT`). A field still sitting at its default takes the
theme's value; a field the user has changed keeps the user's value and the theme
loses. This is per field, so a theme can set the family of a user who never
picked one while still respecting the size they did pick.

This is a deliberate divergence from upstream Terax, where the theme wins
outright. Switching themes here never discards a font someone chose on purpose.

**Name a family you actually ship.** `fontFamily` is passed to xterm as-is, so a
face that is neither bundled nor installed on the system silently falls back to
the next family in the stack. If your theme needs a bundled face, list it in
`type.fonts` as well so `ThemeProvider` loads it. End the string with a real
fallback, exactly as with the UI font stacks.

### `shape` (variant-level)

Lengths must match `/^(0|-?\d+(\.\d+)?(px|rem|em))$/` - no `calc()`, no commas,
because several compose into a shared `box-shadow` and a function call would
rewrite the declaration.

| Key | Variable | Default | Effect |
|---|---|---|---|
| `frameWidth` | `--frame-border-width` | `1px` | window frame border |
| `frameRadius` | `--frame-radius` | `12px` | window corner radius |
| `framePadding` | `--frame-padding` | `0px` | inset between frame and chrome |
| `chromeWidth` | `--chrome-border-width` | `1px` | `.terra-chrome` |
| `panelWidth` | `--panel-border-width` | `1px` | `.terra-panel` |
| `slotWidth` | `--slot-border-width` | `1px` | `.terra-slot` |
| `controlWidth` | `--control-border-width` | `1px` | `.terra-control` |
| `bevelWidth` | `--bevel-width` | `0px` | ring thickness |
| `bevelOuter` / `bevelMid` / `bevelInner` | `--bevel-*` | `transparent` | three stacked inset rings |
| `liftColor` / `liftDepth` | `--lift-*` | `transparent` / `0px` | hard drop shadow |
| `spacing` | `--ui-spacing` | `0.25rem` | **every** padding, gap, and size utility |

`spacing` is a blunt instrument. It rescales all 200-plus spacing utilities at
once, which will overflow rows that size on content. Change it only with a way to
look at the result, and expect to fix overflows.

### `type` (variant-level)

| Key | Variable | Notes |
|---|---|---|
| `sans` | `--ui-font-sans` | the UI font |
| `mono` | `--ui-font-mono` | see the warning below |
| `display` | `--ui-font-display` | `.terra-chrome-label` only |
| `chromeTracking` | `--chrome-tracking` | prefer `em` so it scales |
| `chromeTransform` | `--chrome-transform` | `none`, `uppercase`, `lowercase` |
| `fonts` | (none) | ids from the bundled registry, lazily loaded |

Always end a family string with a real fallback:
`"'Pixelify Sans', 'Inter Variable', sans-serif"`.

**Think twice before setting `mono`.** Every `font-mono` site in Terra is an
8.5px to 12px commit hash, file path, version string, or `kbd` chip. A display
or pixel face is illegible at those sizes. Stardew deliberately leaves `mono`
unset and keeps JetBrains Mono.


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

## Fonts

A theme may name any installed family in `sans`/`mono`/`display`, but that
depends on the user's machine. To guarantee a face, use the bundled registry:

1. `pnpm add @fontsource/<face>`
2. Add the id to `FONT_IDS` and a loader to `LOADERS` in
   `src/modules/theme/fonts.ts`
3. List it in `type.fonts`; `ThemeProvider` imports it only when your theme is
   active, so an unused face costs nothing in the eager bundle
4. If the face is referenced only from a CSS `url()`, add the package to
   `ignoreDependencies` in `knip.json` (see `@fontsource-variable/inter` for
   precedent)

### Font metrics matter more than font size

Display faces have wildly non-standard metrics, and this is the single most
common reason a theme "looks wrong":

| Face | x-height | cap-height |
|---|---|---|
| Inter (the baseline) | 0.546em | 0.727em |
| Pixelify Sans | 0.450em | 0.700em |
| VT323 | 0.400em | 0.560em |
| Press Start 2P | 0.750em | **1.000em** |

Press Start 2P at 12px has 12px capitals against Inter's 8.7px, so it renders
38% larger while VT323 renders smaller. A theme using both gets a display font
that shouts and a body font that whispers.

**Correct the font, not the font size.** Terra has ~250 `text-[11px]`-style
literals against ~125 `text-xs`/`text-sm` sites, so a font-size scale token would
only reach a third of the UI and leave it visibly mixed. Instead declare the
face by hand with `size-adjust` (see `src/styles/pixelify-sans.css`), which is a
font metric and applies everywhere at once. Webviews without `size-adjust`
render at 100%, which degrades to the unscaled appearance rather than a broken
one.

To measure a face, parse its `.woff` (the `head` and `OS/2` tables give
`unitsPerEm`, `sxHeight`, `sCapHeight`) rather than guessing.

## Surface classes

Six classes in `globals.css` compose the shape tokens. Components opt in by
adding the class; themes never reference them.

| Class | Applied to | Composition |
|---|---|---|
| `.terra-frame` | app root (`App.tsx`) | frame width, bevel rings, lift, `--frame-padding` |
| `.terra-chrome` | header, statusbar, explorer header | chrome width |
| `.terra-panel` | explorer | panel width, bevel rings |
| `.terra-slot` | **nothing yet** | slot width, single inner bevel |
| `.terra-control` | **nothing yet** | control width |
| `.terra-chrome-label` | explorer header | display font, tracking, transform |

Three things to know:

1. **The classes live in `@layer components`, below utilities.** A component's
   own Tailwind classes still win, so adding `.terra-panel` can never override a
   deliberate `border-b-0`.
2. **`--surface-border-width` is registered `inherits: false`** via `@property`.
   Without that registration a surface class hands its width to every descendant,
   and `.terra-chrome` on the header would thicken every button inside it. If you
   add a surface class, keep the registration.
3. **`.terra-slot`, `.terra-control`, and the lift shadow have no consumers.**
   Setting `slotWidth`, `controlWidth`, `liftColor` or `liftDepth` currently
   renders nowhere. The lift is an outset shadow on `.terra-frame`, which
   `#root`'s `overflow: hidden` clips. Adopting `.terra-control` means editing
   `components/ui/button.tsx`, which `TERRA.md` marks as shadcn-managed.

### The bevel is three stacked rings

```css
inset 0 0 0 calc(var(--bevel-width) * 1) var(--bevel-outer)
inset 0 0 0 calc(var(--bevel-width) * 2) var(--bevel-mid)
inset 0 0 0 calc(var(--bevel-width) * 3) var(--bevel-inner)
```

So `bevelWidth: "4px"` with three opaque colours paints **12px** of solid ring
inside the element, which is almost always more than intended. For a single
highlight ring, set `bevelMid` and `bevelInner` to `"transparent"`.

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

## Design guidance

Value contrast between panels is the obvious way to separate surfaces, and often
the wrong one. A warm or heavily themed palette usually reads better when
surfaces stay close in tone and a **border does the separating** - that is how
Stardew works, and why its border colour is strong while its surfaces are
nearly uniform.

Corollaries:

- If you set `radius: "0rem"`, also set `frameRadius: "0px"`. The window frame
  has its own radius and stays at 12px otherwise, so the app has square panels
  inside rounded corners.
- A thick `frameWidth` needs `framePadding`, or the chrome butts against the
  border and slides under the bevel ring.
- Chrome borders above ~2px eat real layout. Measure the total: a 4px border
  plus three 4px bevel rings is 16px per edge.

## Before you ship

```
pnpm test            # builtins + terminalLegibility + applyTheme + validateTheme
pnpm check-types
pnpm lint
```

Checklist:

- [ ] Both `light` and `dark` variants defined, with the same colour keys
- [ ] Registered in `themes/index.ts`
- [ ] `editorTheme` modes point at same-mode editor themes
- [ ] Terminal: no slot equals the background; blue differs from cyan
- [ ] Terminal: normals clear 4.5:1, brights and `brightBlack` clear 3:1
- [ ] Terminal background under ~25% saturation
- [ ] Any new token added to `types.ts`, `applyTheme.ts`, `validateTheme.ts`,
      `globals.css`, **and** the assertions in `applyTheme.test.ts`
- [ ] `mutedForeground` clears 4.5:1 against both `card` and `background`
- [ ] If the theme declares `terminal.ansi`, looked at the derived editor and a
      markdown code block side by side
- [ ] Looked at it running. The tests catch dead and invisible colours; they
      cannot tell you whether it looks good.

## Adding a token

Five parallel edits, in this order:

1. `types.ts` - add the key to `ThemeShape` or `ThemeTypography`
2. `applyTheme.ts` - map it in `SHAPE_VAR` or `TYPE_VAR` (`ALL_VARS` derives
   from these, so clearing works automatically). For a syntax or status role,
   add it to `SYNTAX_ROLES`/`STATUS_ROLES` in `types.ts` and the mapping tables in `derive.ts`.
3. `validateTheme.ts` - add it to the right key list, or user themes using it
   fail to load
4. `globals.css` - consume it, always with a `var(--x, <today's value>)`
   fallback so non-opting themes are byte-identical
5. `applyTheme.test.ts` and `surfaceClasses.test.ts` - assert the mapping and
   the default

The zero-change invariant is the headline requirement: a theme that sets none of
the new keys must render exactly as before.
