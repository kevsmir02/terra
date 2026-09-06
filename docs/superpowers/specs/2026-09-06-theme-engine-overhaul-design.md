# Theme engine overhaul: design

Date: 2026-09-06. Status: approved design, awaiting implementation plan.

## Problem

Every Terra theme reads as the default look with a new palette. The owner's
Nothing reference (flat near-black, one signal red, 2 px dotted frame, dotted
dividers, uppercase tracked labels, square corners, glyph icons, no wallpaper,
no blur or shadow) cannot reach the screen, and three commits that tried
(f7ce5dd, c9d32d2, fcca291) each found another hardcoded spot.

The 2026-09-06 audit located the fault. The resolution pipeline (theme file,
`types.ts`, `resolveVariant.ts`, `resolveTheme.ts` with the OKLab
derivations, `applyTheme.ts`) is sound: authored values pass through
untouched and the legibility tests hold. The consumption side is broken:

- The window frame in `globals.css` hardcodes `solid`, so no theme can draw
  a dotted or dashed frame.
- Dividers in the shadcn primitives (separator, resizable handle, command,
  dropdown, context menu, select) and two in the Header are `bg-border`
  fills, which have no border style.
- The chrome label class (display face, tracking, casing) is applied to one
  element, the explorer root name. Fourteen `uppercase` and 25 `tracking-*`
  utilities elsewhere carry their own fixed values.
- `rounded-full` is a literal, so pills and tabs stay round under every
  theme. Blur (10 sites) and shadows (26 sites) have no token at all.
- The wallpaper layer is a global setting painted above every theme surface.
- File icons are Catppuccin SVG data URLs with no theme seam; their peach is
  what the owner saw as a "coral accent".
- Dead tokens: `sidebar*`, `shape.controlWidth`, `shape.liftColor` and
  `liftDepth` (clipped by `#root`), and the `editorTheme` pairing on any
  theme that declares an ANSI palette.

## Goal

Two themes must be able to look structurally different (frame and divider
style, corner shape, label typography, icon set, ambient effects, wallpaper)
without touching a component. Nothing rebuilt to its reference is the
acceptance case; the contract must hold for every future theme.

## Decisions already made by the owner

- One face everywhere: the system-installed JetBrainsMono Nerd Font, chosen
  for reading comfort. Themes never pick a face.
- Delete the Stardew, Windows XP, and Game Boy builtins.
- A theme decides whether it accepts the wallpaper; the user's image stays
  the source.
- Add a Nerd Font glyph icon set as a theme option; Nothing uses it.
- Chrome labels follow the theme's casing and tracking; content does not.
- Drop the custom JSON theme-file feature; themes are TypeScript builtins.
- Approach B: the theme owns the scales Tailwind utilities resolve through,
  plus a thin role layer for the two properties that have no scale.

## Non-goals

- Re-skinning the Hugeicons chrome icons. They are monochrome strokes that
  already follow the theme's colours.
- Per-theme fonts, weights, or sizes. Font size stays a user preference.
- Theming the terminal grid, the editor's syntax palette derivation, or the
  markdown renderer beyond what the existing tokens already do.
- Runtime theme validation. The compiler and the builtin tests are the gate.

## Theme file contract

A theme is a TypeScript object with `id`, `name`, optional `author` and
`description`, and `variants.light` / `variants.dark`. `editorTheme` is
removed from `Theme` entirely; every kept builtin declares `terminal.ansi`, so
the derived path always won.

Per variant:

| Group | Fields | Notes |
| --- | --- | --- |
| `colors` | shadcn set minus `sidebar*`, plus `radius`, `borderStyle` | unchanged otherwise |
| `terminal` | `background`, `foreground`, `cursor`, `cursorAccent`, `selection`, `ansi` | `fontFamily`, `fontWeight`, `fontSize` removed |
| `shape` | `frameWidth`, `frameRadius`, `framePadding`, `chromeWidth`, `panelWidth`, `slotWidth`, `bevelWidth`, `bevelOuter`, `bevelMid`, `bevelInner`, `spacing`, **`pillRadius`** | `controlWidth`, `liftColor`, `liftDepth` removed |
| `type` | `chromeTracking`, `chromeTransform` | `sans`, `mono`, `display`, `fonts` removed |
| `effects` (new) | `shadow` (colour), `blur` (`on` / `off`), `wallpaper` (boolean) | see below |
| `icons` (new) | `"catppuccin"` / `"nerd"` | read by the explorer, not a CSS variable |
| `syntax`, `status`, `emphasis` | unchanged | |

New token semantics:

- `shape.pillRadius`: length, CSS variable `--radius-pill`, fallback
  `9999px`. What every `rounded-full` resolves to.
- `effects.shadow`: colour, CSS variable `--fx-shadow-color`, fallback
  `rgb(0 0 0 / 0.1)` (Tailwind's default tint). Every `shadow-*` utility
  uses it; `transparent` flattens the app.
- `effects.blur`: keyword, values `on` (fallback) or `off`. The token
  derives CSS variable `--fx-blur-factor` as `1` or `0`, which the
  `--blur-*` scale multiplies.
- `effects.wallpaper`: boolean on the variant, default `true`. Not a token;
  `SurfaceLayer` reads it from the theme object.
- `icons`: keyword on the variant, default `catppuccin`. Not a token; the
  explorer reads it from the theme object.

`tokens.ts` gains the three CSS-backed entries and loses the removed ones.
`types.ts`, `builtins.test.ts`, and the token-reference generator follow.

## Consumption contract

### Scales

`globals.css` already bridges `--radius-*` to the theme's `--radius` and
re-emits the `border`, `border-t/b/l/r` utilities to read
`--surface-border-width`. The same two techniques extend to:

- `--blur-*`: each step becomes `calc(var(--fx-blur-factor) * <default>)`,
  where `--fx-blur-factor` is `1` for `on` and `0` for `off`. `applyTheme`
  writes the factor from the keyword.
- Shadows: Tailwind inlines shadow values, so `shadow-sm`, `shadow-md`,
  `shadow-lg`, `shadow-xl`, and `shadow-2xl` are re-emitted with
  `@utility`, identical to Tailwind's output except that the tint reads
  `var(--fx-shadow-color, rgb(0 0 0 / 0.1))`. Arbitrary `shadow-[...]` is
  forbidden.
- `rounded-full` is retired. A same-named `@utility` merges with Tailwind's
  and Tailwind's declaration wins, so pills use a new `rounded-pill` utility
  (`border-radius: var(--radius-pill, 9999px)`) and the contract test forbids
  `rounded-full`.
- A new `rounded-circle` utility (`border-radius: 50%`) is for geometric
  circles: status dots, avatars, spinners. It never reads a theme variable.
  Existing `rounded-full` on such elements is migrated to `rounded-circle`.

### Frame and dividers

- The `#root` and `#settings-root` frame rule reads
  `var(--border-style, solid)` instead of the literal `solid`.
- Every divider that is a `bg-border` fill becomes a real border on a
  zero-size box (`border-t` with `h-0`, or `border-l` with `w-0`): the
  shadcn `separator`, the `resizable` handle line, and the separators in
  `command`, `dropdown-menu`, `context-menu`, `select`, plus the two in
  `Header.tsx`. They inherit the theme's border style at the 1 px initial
  width unless the divider itself carries a surface class.

### Labels

`.terra-chrome-label` is renamed `.terra-label` and reduced to
`letter-spacing: var(--chrome-tracking, inherit)` and
`text-transform: var(--chrome-transform, none)`. It goes on chrome text
only:

- tab titles in `TabBar`
- header buttons and menu labels
- statusbar chips (the breadcrumb path is content and stays lowercase, as in
  the reference)
- sidebar rail labels (Files, Source, Devices)
- panel section headings (explorer root, source control groups, git history
  headings, notification bell sections, space settings groups)
- command palette group headings
- settings navigation and section titles

Content keeps its own case: file names in the tree, commit messages, diff
text, terminal, editor, markdown, toast bodies. Every hardcoded `uppercase`
and arbitrary tracking value on chrome text is replaced by the class. Named
`tracking-*` steps keep Tailwind's values; only arbitrary `tracking-[...]` is
forbidden.

### Contract test

`src/app/theme-contract.test.ts`, modelled on `eager-budget.test.ts`, scans
`src/**/*.tsx` and `src/**/*.ts` (excluding tests) and fails on:

- arbitrary `rounded-[`, `shadow-[`, `tracking-[`, `blur-[`,
  `backdrop-blur-[`
- the `uppercase` and `lowercase` utilities
- `border-solid`, `border-dashed`, `border-dotted`, `border-double`
- raw colour literals in class names or inline styles (`#[0-9a-f]{3,8}`,
  `rgb(`, `hsl(`, `oklch(`) outside the theme module and `globals.css`

An allowlist maps file path to reason for genuine exceptions (agent brand
marks in `agentIcon.tsx`, the device mirror's video surface, xterm glue).
Adding to it is a reviewed change. A second block asserts `globals.css`
contains the `rounded-full` and shadow re-emissions and that the frame rule
reads `--border-style`.

## Icon seam

`src/modules/explorer/lib/iconResolver.ts` becomes a provider interface:

```ts
type FileIcon =
  | { kind: "image"; url: string }
  | { kind: "glyph"; char: string };
interface IconProvider {
  file(name: string, languageId?: string): FileIcon;
  folder(name: string, open: boolean): FileIcon;
}
```

- `catppuccinProvider` keeps today's data-URL logic but imports
  `@iconify-json/catppuccin/icons.json` and the name tables lazily, so the
  JSON (about 71 kB gzipped) leaves the eager graph. `eager-budget.test.ts`
  locks `@iconify-json/catppuccin` out of both windows' eager sets.
- `nerdProvider` is a static table of about sixty extensions and folder
  names to Nerd Font codepoints with a folder, open-folder, and generic file
  fallback. Glyphs render as `<span aria-hidden className="terra-file-icon">`
  in the app font, coloured by `currentColor`; the row decides the colour
  (folder rows use the primary colour, file rows the row text colour).
- `TreeRow`, `FileExplorer`, and `ExplorerSearch` render through a
  `useIconProvider()` hook that reads the active variant's `icons`.
- The light-mode contrast filter in `globals.css` stays scoped to the
  Catppuccin `<img>` elements.

## Wallpaper

- `wallpaperAllowed(theme, mode, prefs)` in `src/modules/theme/wallpaper.ts`
  returns true only when the preference is on, an image id exists, and the
  active variant's `effects.wallpaper` is not false. `SurfaceLayer` returns
  null otherwise, so a declining theme costs nothing.
- The pre-hydration fast path already stores the theme id and mode in
  localStorage; `readBgFastPath` consults the builtin's flag synchronously
  so Nothing never flashes the image on launch.
- The background section in Settings renders a disabled state reading
  "Declined by the active theme" when the flag is false.

## Fonts

- `--font-sans`, `--font-mono`, and `--font-heading` in `globals.css`
  resolve to `"JetBrainsMono Nerd Font", monospace`.
- The terminal default family becomes `"JetBrainsMono Nerd Font Mono"`,
  whose icon glyphs occupy one cell. `terminalFontFamily`, `terminalFontWeight`,
  and `terminalFontSize` remain user preferences with the new default; a
  stored non-empty family still wins.
- Removed: `fonts.ts`, `resolveTerminalFont.ts` and its test,
  `useTerminalFont`'s theme branch, `src/styles/fonts.css`,
  `space-grotesk.css`, `pixelify-sans.css`, and the seven `@fontsource`
  packages. `index.html` and `settings.html` lose any font preloads.

## Custom themes removal

Removed: `customThemes.ts`, `themeFiles.ts`, `useThemeFileEditing.ts`,
`validateTheme.ts`, `diagnostics.ts`, their tests, the `customThemes`
field on the theme context, the store key and its change listener, and the
create, edit, import, delete UI in `ThemesSection`. The Settings picker
lists builtins only. No Rust command exists only for theme files (the loader
used the generic `fs_*` commands), so `lib.rs` is unchanged; the theme-edit
Tauri event between the Settings and main windows goes with the loader.

## Builtins

- Deleted: `stardew.ts`, `windows-xp.ts`, `gameboy.ts`.
- `nothing.ts` rebuilt to the reference: `frameWidth: "2px"`,
  `borderStyle: "dotted"`, `chromeTransform: "uppercase"`,
  `chromeTracking: "0.08em"`, `radius: "2px"`, `pillRadius: "2px"`,
  `effects.shadow: "transparent"`, `effects.blur: "off"`,
  `effects.wallpaper: false`, `icons: "nerd"`. Colours keep the current
  signal red and near-black canvas; the `editorTheme` block goes.
- `terra-default.ts`, `rebar.ts`, `gruvbox.ts`, `kanagawa.ts`,
  `kanagawa-dragon.ts`: font and dead fields removed; new fields left at
  defaults so they render as today apart from the face.
- A stored `themeId` naming a deleted theme falls back to the default, which
  `ThemeProvider` already does for unknown ids.

## Tests

- New: `theme-contract.test.ts` (scan and CSS assertions), `wallpaper.test.ts`
  (deny path: preference on but theme declines; fast path parity),
  `nerdProvider` mapping test (known extension, folder open/closed, unknown
  falls back), `eager-budget.test.ts` gains `@iconify-json/catppuccin`.
- Changed: `builtins.test.ts` asserts every builtin's new fields are valid
  and no builtin names a font; `terminalLegibility` and `syntaxLegibility`
  run unchanged over the remaining six themes.
- Removed: the 7000-line `resolveTheme` snapshot, replaced by assertions on
  the derived tokens (each `derive` produces a value meeting its contrast
  target for every builtin and mode) and a single small snapshot of Nothing
  dark as the acceptance case.

## Documentation

- `THEME.md` rewritten around the new contract: scales, `terra-label`,
  `rounded-circle` versus `rounded-full`, effects, icons, wallpaper, the
  single font, and the contract test's allowlist rule.
- `TERRA.md` theme paragraph updated; the custom theme and font-loading
  claims removed.
- `docs/adr/0003-theme-consumption-through-scales.md`: components consume
  the theme through Tailwind scales and the label role class, never through
  literal utilities; the theme owns the scales.

## Budgets

The eager set shrinks by the font CSS, the Catppuccin JSON, and the custom
theme code. After `pnpm build && pnpm size:eager`, `eager-budget.json` and
`.size-limit.json` are lowered to the measured values; the commit message
records the numbers.

## Risks and verifications during implementation

- Shadow re-emission must reproduce Tailwind's composite `box-shadow`
  exactly; verify against the built CSS before and after.
- `backdrop-filter: blur(0px)` still creates a compositing layer; acceptable
  visually, and the alternative (dropping the filter) would need a class.
  Keep the factor approach unless it measurably hurts.
- Nerd Font glyph widths in a proportional layout: the icon span gets a
  fixed `1.25em` width and centred text so rows stay aligned.
- Fish, zsh, and Claude Code TUI rendering under the Mono variant: smoke
  test in the running app.
- The `rounded-full` migration to `rounded-circle` is a judgement per site;
  the rule is "would this look wrong as a square", not "is it small".

## Order of work

1. Frame border style and dividers as borders.
2. Theme-owned scales, pill and circle radii.
3. Remove custom JSON theme files.
4. One font for the whole app, three font-heavy themes deleted.
5. Theme file contract.
6. Chrome labels wear `terra-label`.
7. Icon seam with a Nerd Font glyph set and a lazy Catppuccin set.
8. The theme decides whether the wallpaper shows.
9. Nothing rebuilt, docs, ADR, budgets.

Each step leaves CI green and is its own commit.
