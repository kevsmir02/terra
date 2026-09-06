# 0003. Chrome consumes the theme through scales, never through literals

Status: accepted

## Context

By 2026-09 every Terra theme rendered as the default look with a new palette.
The resolution pipeline was sound: authored values reached CSS variables
untouched. The consumption side was not. The window frame hardcoded `solid`,
dividers were `bg-border` fills with no border style, the chrome label class
was applied to one element while fourteen `uppercase` and twenty-five
`tracking-*` utilities carried their own values, `rounded-full` was a literal,
and blur and shadow had no token at all. Three commits that tried to make the
Nothing theme reach the screen each found another hardcoded spot, because
nothing recorded what the chrome consumed versus what it merely could.

## Decision

The theme owns the scales Tailwind utilities resolve through. `globals.css`
maps `--radius-*`, `--shadow-*`, and `--blur-*` to theme-facing variables with
Tailwind's defaults as fallbacks, re-emits the `border*` width utilities, and
adds `rounded-pill` (theme radius) and `rounded-circle` (geometry). Chrome text
wears the `terra-label` utility for casing and tracking. Dividers are borders.
The explorer icon set and the wallpaper are theme-declared fields read by their
consumers. Components keep plain Tailwind and never use `rounded-full`,
`uppercase`, `lowercase`, arbitrary `rounded-[...]`, `shadow-[...]`,
`blur-[...]`, `tracking-[...]`, explicit `border-<style>`, or a palette colour.
`src/app/theme-contract.test.ts` scans the source tree and fails on any of
these outside an allowlist whose every entry names its reason.

Themes are TypeScript builtins. The custom JSON theme feature was removed; the
compiler and the builtin tests are the gate. The whole app renders in the
system JetBrainsMono Nerd Font; themes do not choose a face.

## Alternatives considered

A role class on every chrome element (explicit, but forty files, hard to test
mechanically, and redundant with what the scales give for free). Handwritten
CSS for the chrome (maximal control, discards shadcn, largest diff, no
enforcement). Re-emitting `rounded-full` with `@utility` (rejected because
Tailwind merges a same-named utility with its own and its declaration wins).

## Consequences

A new theme changes the look without touching a component. A new component is
themeable by construction if it passes the contract test. Scale names carry
theme meaning, so a designer thinks in steps (`shadow-lg`, `rounded-pill`)
rather than pixels. Adding an allowlist entry is a reviewed change named in
the commit message. The eager bundle shrinks by the font CSS, the Catppuccin
JSON, and the custom theme code.
