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

`background`, `foreground`, `cursor`, `cursorAccent`, `selection`, and `ansi`:
exactly 16 strings in the standard order.

```
0-7   black red green yellow blue magenta cyan white
8-15  the same eight, bright
```

Rules that `terminalLegibility.test.ts` enforces across every built-in:

- **No slot may equal the background.** Retro Pixel once shipped
  `brightWhite === background`, which is invisible text, not a colour choice.
- **Blue must differ from cyan**, in both the normal and bright rows.
- **`foreground` vs `background` must clear 4.5:1.**

Rules the test only enforces numerically for Retro Pixel, but that you should
hold anyway:

- Normal slots 1-7 clear **4.5:1** against your background.
- Bright slots 9-15 clear **3:1**.
- **Slot 8 (`brightBlack`) clears 3:1.** This is the one everyone gets wrong: it
  is the comment colour in most tooling, and a "subtle" value lands at 1.6:1 and
  makes every comment unreadable.
- Slot 0 (`black`) is exempt. It is legitimately near-background on dark themes.

**Keep the terminal background desaturated.** Well-regarded terminal palettes sit
at 5-25% HSL saturation (gruvbox-hard `#1d2021` is 6%, kanagawa `#1f1f28` is 15%,
rose-pine `#191724` is 19%). Above roughly 30% the background stops being a tint
and becomes a colour, and it visibly pushes its hue into every slot drawn on it.
Pick your hue from the theme, then pull saturation down.

The terminal **font** is a user preference (`terminalFontFamily`), not a theme
token. A theme controls terminal colour only.

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
or pixel face is illegible at those sizes. Retro Pixel deliberately leaves `mono`
unset and keeps JetBrains Mono.

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

## Editor pairing

`editorTheme: { light, dark }` names a CodeMirror theme from `EDITOR_THEMES` in
`src/modules/settings/store.ts`. It applies when the user's editor preference is
`auto`. Pair each mode with a theme of the **same** mode: pointing `dark` at
`solarized-light` gives a light editor inside a dark app.

## Design guidance

Value contrast between panels is the obvious way to separate surfaces, and often
the wrong one. A warm or heavily themed palette usually reads better when
surfaces stay close in tone and a **border does the separating** - that is how
Retro Pixel works, and why its border colour is strong while its surfaces are
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
- [ ] Looked at it running. The tests catch dead and invisible colours; they
      cannot tell you whether it looks good.

## Adding a token

Five parallel edits, in this order:

1. `types.ts` - add the key to `ThemeShape` or `ThemeTypography`
2. `applyTheme.ts` - map it in `SHAPE_VAR` or `TYPE_VAR` (`ALL_VARS` derives
   from these, so clearing works automatically)
3. `validateTheme.ts` - add it to the right key list, or user themes using it
   fail to load
4. `globals.css` - consume it, always with a `var(--x, <today's value>)`
   fallback so non-opting themes are byte-identical
5. `applyTheme.test.ts` and `surfaceClasses.test.ts` - assert the mapping and
   the default

The zero-change invariant is the headline requirement: a theme that sets none of
the new keys must render exactly as before.
