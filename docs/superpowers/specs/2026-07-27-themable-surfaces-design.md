# Themable Surfaces (Design)

**Goal:** Let a theme express the *Terra Retro Pixel UI* reference (heavy multi-tone frames, pixel display font, chunky chrome) through theme tokens alone, with no per-theme component code, no theme-authored CSS, and byte-identical rendering for every theme that does not opt in.

**Reference:** Claude Design project `7a5c9601-e2cd-43c4-b0af-5ebf716f3fef`, file `Terra Retro Pixel UI.dc.html`. (`support.js` in that project is the generated design-canvas React runtime, not design content.)

---

## Problem

Terra's theme engine writes 48 CSS custom properties and nothing else. `applyTheme.ts:65` is a generic key to variable writer, so the engine is not the constraint. The constraint is that a theme can only reach a property Tailwind compiled into a `var()`.

Compiling `src/styles/globals.css` with the Tailwind 4 API shows the split:

| Utility | Compiles to | Reachable |
|---|---|---|
| `bg-background` | `background-color: var(--background)` | yes |
| `rounded-lg` | `border-radius: var(--radius)` | yes |
| `p-2`, `h-7`, `gap-1.5` | `calc(var(--spacing) * n)` | variable exists, nothing writes it |
| `text-sm` | `font-size: var(--text-sm)` | variable exists, nothing writes it |
| `border` | `border-width: 1px` | no, literal |
| `font-sans` | `font-family: 'Inter Variable', sans-serif` | no, literal |
| `shadow-lg` | `0 10px 15px -3px rgb(0 0 0/0.1)` | no, literal |

Colors and `--radius` survived because they were authored as `var(...)` inside `@theme inline`, which inlines the *value*. `--font-sans` was authored as a literal, so it is baked into every `.font-sans` rule and setting it at runtime does nothing.

This is why `74b46c0` could make border *style* themable but `a8775d0` had to settle for raising Wireframe's border alpha from 0.42 to 0.62. That commit message states the constraint exactly: *"A theme sets border colour only; width comes from per-component Tailwind classes, so alpha is the available lever at 1px."* There are 160 border utilities across 54 files (`border` x120, `border-b` x18, `border-t` x16, `border-l` x4, `border-r` x2), every one of them 1px.

### What the reference actually needs

Reading the recipes out of `Terra Retro Pixel UI.dc.html`:

```css
.wood-panel {
  background: #deb887;
  border: 8px solid #6b4226;
  box-shadow:
    inset 0 0 0 4px  #8a5a2e,
    inset 0 0 0 8px  #6b4226,
    inset 0 0 0 12px #4a2d16,
    0 6px 0 #2a1a0d,
    0 10px 18px rgba(0,0,0,.5);
}
.slot {
  background: #f4e4bc;
  border: 4px solid #6b4226;
  box-shadow: inset 0 0 0 2px #a97c50;
}
```

Two observations drive the whole design.

**First: border width is per-surface, not global.** The reference uses five distinct widths, chosen by what kind of surface it is:

| Reference surface | Border | Terra equivalent |
|---|---|---|
| outer plate | `8px` + three inset rings | `#root` under `html[data-chrome="borderless"]` |
| titlebar bottom, sidebar sides | `6px` | `modules/header`, `modules/sidebar` |
| statusbar top, content top | `5px` | `modules/statusbar` |
| panel header bottom, slot | `4px` | explorer section headers, cards |
| tabs, buttons, swatches, window controls | `3px` | `components/ui/button`, tabs |

A single `--ui-border-width` token would flatten all of these to one value. It cannot express the design.

**Second: the recipes are few and fixed.** The entire mockup is built from exactly three surface treatments (`wood-panel`, `slot`, and a bare 3px control border) plus a scrollbar and a label style. It does not need arbitrary CSS. It needs a small set of *named surfaces* whose properties come from variables.

That is the design. It also removes the security problem: if themes only ever set variables, a theme file never contains a selector, so there is nothing to sandbox and no DOM coupling to break on refactor.

### Blockers beyond tokens

- **Fonts.** The reference uses `Press Start 2P` (display) and `VT323` (body), loaded from Google Fonts. Terra bundles fonts locally via `@fontsource` (`styles/fonts.css`) and the webview must not reach the network.
- **Icons.** The reference uses `pixelarticons` with `image-rendering: pixelated`. `explorer/lib/iconResolver.ts:1` hard-imports `@iconify-json/catppuccin/icons.json` at module scope, eagerly, with no theme hook.
- **Scrollbars.** The reference has a 16px hatched wooden scrollbar with arrow buttons. `globals.css:308-324` kills every native scrollbar app-wide with `display: none !important`, deliberately: Chromium's bars broke the chrome on Linux and Windows, and macOS flashed its overlay during pane transitions.

---

## Architecture

Four layers, each independently shippable and each inert until a theme opts in.

### Layer 1: token expansion

`ThemeVariant` gains sibling groups next to `colors` and `terminal`. `ThemeColors` keeps its name and its existing keys (including the already-misplaced `radius` and `borderStyle`) so every existing theme file and all 19 built-ins parse unchanged.

```ts
type ThemeVariant = {
  colors?: ThemeColors;
  terminal?: TerminalPalette;
  shape?: ThemeShape;
  type?: ThemeTypography;
};

type ThemeShape = Partial<{
  frameWidth: string;    // --frame-border-width   default 1px
  chromeWidth: string;   // --chrome-border-width  default 1px
  surfaceWidth: string;  // --surface-border-width default 1px
  controlWidth: string;  // --control-border-width default 1px
  bevelOuter: string;    // --bevel-outer   default transparent
  bevelMid: string;      // --bevel-mid     default transparent
  bevelInner: string;    // --bevel-inner   default transparent
  bevelWidth: string;    // --bevel-width   default 0px
  liftColor: string;     // --lift-color    default transparent
  liftDepth: string;     // --lift-depth    default 0px
  spacing: string;       // --spacing       default 0.25rem
}>;

type ThemeTypography = Partial<{
  sans: string;          // --ui-font-sans
  mono: string;          // --ui-font-mono
  display: string;       // --ui-font-display, chrome labels
  chromeTracking: string;   // --chrome-tracking   default normal
  chromeTransform: string;  // --chrome-transform  default none
  scale: string;         // multiplier on --text-*, default 1
}>;
```

Every default is the value that renders today. `applyTheme` writes these through the same `setProperty` loop; only the key to variable maps grow.

Two `globals.css` changes make the existing utilities reachable:

```css
@theme inline {
  --spacing: var(--ui-spacing, 0.25rem);
  --font-sans: var(--ui-font-sans, 'Inter Variable', sans-serif);
  --font-mono: var(--ui-font-mono, 'JetBrains Mono', monospace);
}
```

`--spacing` and `--text-*` are already variable-driven by Tailwind itself, so wrapping them costs two lines and unlocks density and type scale across all 213 spacing and sizing utilities.

Border width needs a `@utility` override, because the width lives in the utility, not the base layer. Verified against Tailwind 4.3.2: this emits a second `.border` rule inside `@layer utilities`, after the built-in, at equal specificity, so it wins.

```css
@utility border   { border-width: var(--surface-border-width, 1px); }
@utility border-t { border-top-width: var(--surface-border-width, 1px); }
@utility border-b { border-bottom-width: var(--surface-border-width, 1px); }
@utility border-l { border-left-width: var(--surface-border-width, 1px); }
@utility border-r { border-right-width: var(--surface-border-width, 1px); }
```

The custom `.border` also sorts after `.border-2`, so an element carrying both would take the variable. The repo has exactly two non-1px sites, `components/ui/switch.tsx:18` (`border-2`) and `modules/git-history/GitHistoryPane.tsx:714` (`border-l-2`), and neither combines with a bare `border`. No live conflict; a test locks this.

### Layer 2: surface classes

Six classes, defined once in `globals.css`, written purely in terms of the Layer 1 variables. Components add the class; themes never write CSS.

| Class | Applied to | Composition |
|---|---|---|
| `.terra-frame` | app root under borderless chrome | `border-width: var(--frame-border-width)` + bevel rings + lift shadow |
| `.terra-chrome` | header, statusbar | `border-width: var(--chrome-border-width)` |
| `.terra-panel` | sidebar, side panels | `border-width: var(--surface-border-width)` + bevel rings |
| `.terra-slot` | cards, input bar | `border-width: var(--surface-border-width)` + inner bevel |
| `.terra-control` | buttons, tabs, window controls | `border-width: var(--control-border-width)` |
| `.terra-chrome-label` | section headers, tab labels | `letter-spacing`, `text-transform`, `font-family: var(--ui-font-display)` |

The bevel is one shared declaration:

```css
.terra-frame, .terra-panel {
  box-shadow:
    inset 0 0 0 calc(var(--bevel-width) * 1) var(--bevel-outer),
    inset 0 0 0 calc(var(--bevel-width) * 2) var(--bevel-mid),
    inset 0 0 0 calc(var(--bevel-width) * 3) var(--bevel-inner),
    0 var(--lift-depth) 0 var(--lift-color);
}
```

With `--bevel-width: 0px` and the colors `transparent`, this computes to a no-op shadow. The Retro Pixel theme sets `--bevel-width: 4px` and the three browns and gets the reference frame.

**Specificity rule:** these classes live in `@layer components`, below utilities. A component's own Tailwind classes therefore still win, so adding `.terra-panel` can never override a deliberate `border-b-0`. This is the opposite of the theme-authored-CSS approach considered earlier and is the reason that approach is dropped.

### Layer 3: fonts

A theme names fonts from a bundled registry rather than supplying a family string that may not exist on the machine:

```ts
type ThemeTypography = { ...; fonts?: readonly FontId[] };
```

`FontId` covers the bundled set. Retro Pixel adds `press-start-2p` and `vt323` via `@fontsource`. Each font's `@font-face` CSS is a lazy `import()` fired by `ThemeProvider` only when the active theme lists it, so an unused font costs nothing in the eager bundle. A theme may still pass an arbitrary family string in `sans`/`mono`/`display` for system fonts; the registry is only for fonts Terra ships.

### Layer 4: icons and scrollbars

**Icons.** New top-level `iconSet?: "catppuccin" | "pixel"` on `Theme`. `iconResolver.ts` moves its icon JSON behind a lazy import keyed on the active set. This also removes an eager `@iconify-json/catppuccin/icons.json` from the bundle, which is a win independent of theming.

**Scrollbars.** Opt-in only. A theme may set `shape.scrollbar`, which writes `--scrollbar-width`, `--scrollbar-track`, `--scrollbar-thumb`. `ThemeProvider` sets `data-scrollbars="themed"` on `<html>` only when present, and the `globals.css:308-324` kill rules are scoped to `html:not([data-scrollbars="themed"])`. Themes that say nothing keep today's behavior exactly, so the documented Linux/Windows/macOS glitches stay fixed for everyone else.

---

## Behavior

- A theme setting none of the new keys renders identically to today.
- Layer 1 keys apply globally through existing utilities. Layer 2 keys apply only where a component carries the class.
- Preview (`previewThemeId`) covers all new keys, since they route through the same `applyTheme` call.
- Both webviews (main and settings) apply the same tokens; they already mount `ThemeProvider` independently.

---

## Prerequisite

`customThemes.ts:11` returns raw store JSON straight into `applyTheme` with no validation. Validation currently runs only on the import and editor-save paths. With colors this was low severity. With shape and typography keys feeding `box-shadow` and `font-family` it is not, so `listCustomThemes` must filter every entry through `validateTheme` and drop failures **before** Layer 1 ships.

Separately, `validateTheme.ts:47` hard-rejects unknown keys. Once the namespace grows, a theme file authored on a newer build fails to load entirely on an older one. Switch to warn-and-drop for unrecognized keys in the same change.

---

## Testing

- **Zero-change invariant (headline).** Compile `globals.css` before and after Layers 1 and 2; the emitted CSS must be equivalent when no theme sets a new variable. Lock as a test that asserts the `.border` override resolves to `1px` with no variable set.
- `applyTheme` is currently untested. Add coverage for: clear-then-set, the `variants[mode] ?? dark ?? light` fallback, and that shape and typography keys write the right variables.
- `validateTheme` cases for each new key, including rejection of a non-allowlisted `borderStyle` and of unknown keys degrading to warn-and-drop.
- Extend `themes/builtins.test.ts:34` both-variants assertion from the four newest themes to all built-ins.
- `listCustomThemes` drops an invalid stored entry instead of applying it.

---

## Non-goals

- **Theme-authored CSS.** Rejected: it lets an imported theme hide UI, cover the window, or exfiltrate via `url()`, and it welds themes to internal class names.
- **Terminal chrome.** Already fully themable (background, foreground, cursor, selection, 16 ANSI slots). No work needed.
- **Pixel fidelity to the mockup's layout.** The reference shows a `DEVICES` tab, a title-bar accent square, and a `PIXEL FARM MODE` status label that are not Terra's UI. A theme cannot add elements.
- **Decorative ornaments.** The reference's `.corner-tl/tr/bl/br` blocks are four absolutely-positioned squares. Out of scope; the frame bevel carries the look without them.

---

## Accepted limitations

- Bevels land only on elements carrying a surface class. Coverage grows as classes are added; early on some panels will look flat under the Retro Pixel theme.
- `rounded-full` (36 sites) and `rounded-none` (4 sites) bypass `--radius` by design and stay bypassed.
- A theme naming a font outside the bundled registry depends on that font being installed.

---

## Phasing

| Phase | Contents | Risk |
|---|---|---|
| 0 | `listCustomThemes` validation, warn-and-drop unknown keys | none, pure hardening |
| 1 | Layer 1 tokens, `@theme inline` wrapping, `@utility` border overrides | none, provably zero visual change |
| 2 | Layer 2 surface classes, applied to header, statusbar, sidebar, explorer header, cards, buttons | low, additive class names |
| 3 | Retro Pixel built-in theme authored against the reference palette | none, new file |
| 4 | Fonts, icon set, opt-in scrollbars | low, each gated behind a theme key |

Phases 0 and 1 are reviewable as one commit and unlock immediate improvement to the existing Wireframe and Arcade themes, independent of anything Retro Pixel needs.

## Reference palette

For Phase 3, transcribed from the reference:

| Token | Value | Role |
|---|---|---|
| `background` | `#deb887` | panel body |
| `card` / `popover` | `#f4e4bc` | content surface |
| `foreground` | `#4a2d16` | primary ink |
| `mutedForeground` | `#8a6a4a` | hint text |
| `border` | `#4a2d16` | primary rule |
| `primary` | `#c76b3c` | accent |
| `destructive` | `#c0392b` | close, error |
| `accent` / `secondary` | `#c9a366` | selected row, section header |
| `sidebar` | `#deb887` | panel body |
| `bevelOuter` | `#8a5a2e` | first inset ring |
| `bevelMid` | `#6b4226` | second inset ring |
| `bevelInner` | `#4a2d16` | third inset ring |
| `liftColor` | `#2a1a0d` | hard drop shadow |
| `radius` | `0rem` | no curve anywhere |

Chrome surfaces (`#6b4226` titlebar and statusbar over `#3a230f` rules) map to `sidebar`/`sidebarBorder`. Widths: frame `8px`, chrome `6px`, surface `4px`, control `3px`, bevel `4px`, lift `6px`.
