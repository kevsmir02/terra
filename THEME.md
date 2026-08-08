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
| `colors.sidebar` | `--sidebar` |  | Sidebar background. |
| `colors.sidebarForeground` | `--sidebar-foreground` |  | Sidebar text. |
| `colors.sidebarPrimary` | `--sidebar-primary` |  | Sidebar primary accent. |
| `colors.sidebarPrimaryForeground` | `--sidebar-primary-foreground` |  | Text on sidebar primary. |
| `colors.sidebarAccent` | `--sidebar-accent` |  | Sidebar accent. |
| `colors.sidebarAccentForeground` | `--sidebar-accent-foreground` |  | Text on sidebar accent. |
| `colors.sidebarBorder` | `--sidebar-border` |  | Sidebar border. |
| `colors.sidebarRing` | `--sidebar-ring` |  | Sidebar focus ring. |
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
| `shape.controlWidth` | `--control-border-width` | `1px` | Control border width. |
| `shape.bevelWidth` | `--bevel-width` | `0px` | Bevel width. |
| `shape.bevelOuter` | `--bevel-outer` | `transparent` | Bevel outer color. |
| `shape.bevelMid` | `--bevel-mid` | `transparent` | Bevel mid color. |
| `shape.bevelInner` | `--bevel-inner` | `transparent` | Bevel inner color. |
| `shape.liftColor` | `--lift-color` | `transparent` | Lift shadow color. |
| `shape.liftDepth` | `--lift-depth` | `0px` | Lift depth. |
| `shape.spacing` | `--ui-spacing` | `0.25rem` | UI spacing. |

### `type`

| Key | Variable | Default | Doc |
|---|---|---|---|
| `type.sans` | `--ui-font-sans` |  | Sans serif font. |
| `type.mono` | `--ui-font-mono` |  | Monospace font. |
| `type.display` | `--ui-font-display` |  | Display font. |
| `type.chromeTracking` | `--chrome-tracking` |  | Chrome letter spacing. |
| `type.chromeTransform` | `--chrome-transform` |  | Chrome text transform. |

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
| `emphasis.faint` | `--emph-faint` | `0.1` | Faint emphasis. |
| `emphasis.subtle` | `--emph-subtle` | `0.3` | Subtle emphasis. |
| `emphasis.soft` | `--emph-soft` | `0.4` | Soft emphasis. |
| `emphasis.medium` | `--emph-medium` | `0.5` | Medium emphasis. |
| `emphasis.strong` | `--emph-strong` | `0.6` | Strong emphasis. |
| `emphasis.bold` | `--emph-bold` | `0.85` | Bold emphasis. |

<!-- token-reference:end -->
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
