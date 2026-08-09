# Design: Windows XP Theme

**Date:** 2026-08-09
**Status:** Approved (design).

## Goal

Add a Windows XP built-in theme: Luna Blue in light mode, Royale Noir in dark,
with the cmd.exe console in both.

## The constraint that shapes everything

A Terra theme sets flat CSS variables and nothing else, and the engine has no
gradient token. XP's signature is gradients: the Luna title bar, the glossy
Start button, the taskbar sheen. None of that is expressible. The `bevel*`
tokens draw **concentric inset rings**, not directional light-top-left and
dark-bottom-right edges, so true 3D bevels are also out of reach.

This is therefore an homage in flat colour and carved rings, not a skin. Adding
a gradient token is a theme-engine change and is out of scope.

### `frameWidth` is inert, so the frame comes from the bevel

`.terra-frame` sets `--surface-border-width`, and the re-defined `border`
utility in `globals.css:72` is what consumes it. The frame element
(`App.tsx:1063`) carries no `border` class, so `--frame-border-width` resolves
and is then never read. Stardew and gameboy both set `frameWidth: "3px"` and
neither draws it; their chunky edge is really the 1px `bevelOuter`.

The XP window frame is built from the three stacked bevel rings instead, which
suits it: a dark outline, a blue frame, a beige inner edge is exactly the
sequence an XP window border runs through.

`frameWidth` is still declared, matching the other themes, so the theme is
correct on the day the frame element gains a border utility. Nothing here
depends on it rendering.

## Decisions

Settled during brainstorming:

1. **Luna Blue** as the light variant, the iconic default style.
2. **Royale Noir** as the dark variant. Microsoft's own dark XP theme, leaked in
   2006, rather than an invented "Luna at night". Terra requires both variants:
   a single-variant theme silently serves the wrong palette across modes, which
   is the bug just fixed in Kanagawa Dragon.
3. **Tahoma named, not bundled.** It is Microsoft-proprietary. The stack is
   `Tahoma, Verdana, 'DejaVu Sans', 'Inter Variable', sans-serif`, so Windows
   users get the real face, most Linux boxes land on DejaVu Sans, and everything
   else falls back. Zero bundle bytes, deliberately inconsistent across
   platforms, which THEME.md permits with a caveat.
4. **The authentic black console in both variants.** Opening Command Prompt on
   Luna gave a black console inside beige chrome, so the terminal does not
   change with the mode.

### Rejected alternatives

- **A white console in light mode.** It would make light mode read as light,
  but a light DOS palette never existed, so it is pure invention.
- **Luna Olive, Luna Silver, Classic.** Less recognizable; Classic is really a
  Windows 2000 theme.
- **High Contrast Black for dark mode.** Historically real but harsh, and it
  abandons the Luna palette entirely.

## Surfaces

XP reads as beige chrome with blue accents, not blue everywhere. `card` is the
header, statusbar **and** the side-panel container, so putting Luna blue there
would turn the whole explorer blue. The blue lands on `primary`, `accent` and
`ring` instead.

| Role | Luna Blue | Royale Noir |
|---|---|---|
| `background` (canvas) | `#ffffff` client area | `#1b1b1b` |
| `card` (header, statusbar, panel) | `#ece9d8` control beige | `#2b2b2b` |
| `popover` | `#ffffff` | `#333333` |
| `primary` | `#245edc` taskbar blue | `#3c7fb1` Royale blue |
| `accent` | `#316ac5` menu highlight | `#2e5a87` |
| `border` | `#aca899` 3D shadow grey | `#4a4a4a` |
| `input` | `#7f9db9` textbox blue-grey | `#5a5a5a` |
| `destructive` | `#a80000` | `#c05050` |

`mutedForeground` is solved against both the canvas and `card` rather than
picked: XP's own grey text `#aca899` is nowhere near 4.5:1 on either.

Shape is hard-edged, as the UI was: `radius: 0rem` with `frameRadius: 0px` to
match, per THEME.md's corollary, and a high emphasis ladder in the same range
stardew and gameboy use. The bevel is `bevelWidth: 1px` with
`bevelOuter #0a246a`, `bevelMid #245edc`, `bevelInner #ece9d8` in light, and a
near-black to charcoal sequence in dark.

## Type

`sans` and `display` take the Tahoma stack. `mono` stays unset, per THEME.md's
warning that every `font-mono` site in Terra is an 8.5px to 12px hash or path.

`terminal.fontFamily` is `'Lucida Console', 'DejaVu Sans Mono', monospace`, XP's
console face. A theme font is a default, not an override, so anyone who has
already chosen a terminal font keeps it.

## Terminal

Identical in both variants, because cmd.exe did not follow the desktop theme.

`terminal.background` is `#0c0c0c` rather than pure black, which lets ANSI slot
0 be a true `#000000` without tripping the not-the-background rule.

**The DOS 16 cannot survive the contrast guard intact, and that is expected.**
Its normal row is the famously unreadable one: `#000080` on black measures about
1.3:1. Even Microsoft's 2017 replacement console palette does not clear 4.5:1 on
the normal row, because terminal palettes have always targeted roughly 3:1
there. So the DOS values are seeds, raised through `ensureContrast`, which moves
OKLab lightness only and leaves the hues intact. It will read as DOS without
measuring as DOS.

Raising a normal slot can push it into its bright twin, which is the collapse
already seen on gruvbox red. Pairs are checked after correction and repaired by
lifting the bright slot, not by lowering the normal back below its floor.

## Verification

- `pnpm test`, `check-types`, `lint`, `knip`, `build`.
- Registration is verified **at runtime**, not by reading `themes/index.ts`.
  That file lists themes in three places (imports, the `export {}` block, and
  the `BUILTIN` array) and an edit that lands only in the export block still
  passes every test. This bit the Game Boy theme once already.
- The snapshot gains exactly two entries. Verified by entry-set diff, not by
  `git diff --numstat`.
- Screenshot both modes with
  `node .claude/skills/run-terra/driver.mjs shot --theme windows-xp --mode <mode>`
  and look at the PNGs. The tests cannot say whether it looks like XP.

## Out of scope

- A gradient token for the theme engine.
- Giving `.terra-frame` a border utility so `frameWidth` renders. It would
  change stardew and gameboy, which are out of scope and already approved.
