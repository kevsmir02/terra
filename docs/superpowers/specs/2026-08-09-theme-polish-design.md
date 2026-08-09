# Design: Theme Polish - terra-default, Kanagawa, Kanagawa Dragon, Gruvbox

**Date:** 2026-08-09
**Status:** Approved (design).

## Goal

Bring the four remaining built-in themes up to the bar set by the three that
were redesigned recently (stardew, nothing, gameboy), and close the test hole
that let them drift in the first place.

The four in scope are palette-only ports. They set `colors` and a partial
`terminal` block and nothing else: no `shape`, no `type`, no `emphasis`, no
`radius`, and borders at 8-14% alpha. The three out of scope set all of it. That
difference is visible: the polished themes feel authored, these feel like
imported hex lists.

## The measured problem

Every built-in was measured in both modes with the repo's own `contrast()` from
`src/modules/theme/oklab.ts`. This is not an aesthetic complaint, it is a list
of numbers below documented floors.

### The guard hole

`terminalLegibility.test.ts:10` returns `null` from `palette()` unless a variant
declares **both** `terminal.background` and `terminal.foreground`:

```ts
if (!t?.ansi || !t.background || !t.foreground) return null;
```

Only stardew, nothing and gameboy declare them. Kanagawa, Kanagawa Dragon and
Gruvbox declare neither, so they are skipped by the entire terminal legibility
suite. Three of seven built-ins have never been measured. Separately, the
numeric floors (normals 4.5:1, brights 3:1, `brightBlack` 3:1) live in a
`describe` block scoped to stardew alone, so even a covered theme only gets the
equality checks.

The fallback is not hypothetical: `globals.css:191` sets
`--terminal-background: var(--background)`, so an undeclared terminal background
really is the app canvas. The test can read the same value the engine does.

### What the numbers say

Contrast against the effective terminal background:

| Theme / mode | Failures |
|---|---|
| gruvbox/dark | ANSI `black #282828` **is** the background; red 2.69, blue 3.48, magenta 3.48 |
| gruvbox/light | ANSI `black #fbf1c7` **is** the background; green 4.29, yellow 3.33, cyan 4.40, white 4.29; BRgreen 2.73, BRyellow 2.19, BRcyan 2.80; `mutedForeground` 4.29 |
| kanagawa/light | `mutedForeground` **2.93** on canvas and **2.56** on card; red 4.06, green 3.26, yellow 4.15, magenta 3.73, cyan 3.88; BRblack 2.93, BRgreen 2.98, BRblue 2.70 |
| kanagawa/dark | red 3.22 |
| kanagawa-dragon | no `light` variant at all; light mode silently serves the dark palette |
| terra-default | no colors, no terminal, nothing to measure |

Two structural findings beyond the ratios:

- **terra-default is not a theme.** It is `variants: { light: {}, dark: {} }`,
  and `ThemeProvider.tsx:144` special-cases it with `clearTheme(); return;`. Its
  real appearance is the unmodified shadcn scaffold plus Tailwind's default ANSI
  set (`#ef4444`, `#3b82f6`, `#eab308`) painted on a pure white `oklch(1 0 0)`
  terminal. Yellow on that background is about 1.9:1. It is the theme most users
  see and the only one no test can reach.
- **terra-default's light `background` and `card` are both `oklch(1 0 0)`.** The
  header, statusbar and side panel container therefore have no value separation
  from the canvas at all.

## Decisions

Settled during brainstorming. Recorded here so they are not relitigated.

1. **Legibility wins, spirit preserved.** Canonical Kanagawa and Gruvbox hexes
   move only in OKLab **lightness**, with hue and chroma pinned, until they clear
   the floor. This is the same operation `derive.ts` already performs on syntax
   roles, so the themes stay recognizably themselves.
2. **terra-default is promoted to a real authored theme**, and the
   `clearTheme()` special case is deleted.
3. **Kanagawa Dragon gets an authored light variant.** Upstream has none (Lotus
   is the light counterpart to regular Kanagawa, not to Dragon), so this is
   invention in Dragon's own language rather than a borrow.
4. **Shape and emphasis yes, new fonts no.** Each theme gets a considered
   radius, border weight, bevel and emphasis ladder. Inter and JetBrains Mono
   stay, so this adds zero font bytes and no `size-adjust` metric work.

### Rejected alternatives

- **Auto-normalizing ANSI at resolve time**, the way syntax roles are already
  normalized. Rejected because the terminal should render the palette that was
  authored. Silently substituting colours in the terminal would make the shipped
  hexes a fiction and would change every theme, including the three out of scope.
- **Strict upstream fidelity.** Rejected by decision 1. It would leave Gruvbox
  dark red at 2.69:1 and keep three themes permanently outside the numeric guard.
- **Reusing Lotus as Dragon's light side.** Rejected because it would make
  Kanagawa and Dragon pixel-identical in light mode.

## Design

### 1. Close the guard hole (first, and on its own)

Two edits to `terminalLegibility.test.ts`:

- `palette()` falls back to `colors.background` and `colors.foreground` when the
  terminal block omits them, matching `globals.css:191`. Every variant carrying
  an `ansi` array becomes measurable.
- The numeric floors move out of the stardew-only block and apply to every
  built-in: normals 4.5:1, brights 3:1, `brightBlack` 3:1. Slot 0 stays exempt
  from the ratio (it is legitimately near-background on dark themes) but not from
  the not-the-background equality rule.

This is done first and lands the suite in a red state. That is the point: the
floors are asserted before any palette is touched, so each subsequent theme is
proven fixed rather than assumed fixed. It is also the invariant lock `TERRA.md`
requires for a change to a core subsystem.

`syntaxLegibility.test.ts` needs no edit. Its `MEASURABLE` filter keys off
`variants.*.colors`, so terra-default enters coverage automatically the moment it
authors colours.

### 2. terra-default: polish, do not replace

The identity stays neutral, clean and quiet. Users recognize this theme, so the
chrome moves as little as possible while the terminal moves a lot.

- Transcribe today's `globals.css` `:root` and `.dark` values into the theme file
  so the UI is a visual no-op at the start.
- Lift the light canvas off pure white so `card` can separate from it. This is
  the one deliberate chrome change, and it fixes an invisible boundary rather
  than restyling anything.
- Author a real 16-slot ANSI palette to replace the Tailwind defaults, and
  declare `terminal.background` and `terminal.foreground` explicitly. Light gets
  an off-white terminal, not `oklch(1 0 0)`.
- Set `shape` and `emphasis` at today's effective values so the theme is
  self-describing rather than relying on engine defaults.
- Delete `ThemeProvider.tsx:144`'s `clearTheme(); return;`.
- Keep `globals.css` in sync with the authored values, because it is still what
  paints before React hydrates. A mismatch would flash on startup.

### 3. Kanagawa: hold canonical, raise only what fails

Dark is nearly clean. Only `red #c34043` (3.22:1) moves, lightness-only.

Light (Lotus) is the real work:

- `mutedForeground` at 2.93 on canvas and 2.56 on card is the worst number in the
  suite. It darkens until it clears 4.5 against both.
- Five normals and three brights rise, lightness-only.
- `terminal.background` is declared and pulled off the canvas. Lotus's `#f2ecbc`
  sits near 67% HSL saturation against the roughly 25% ceiling in `THEME.md`, and
  because the terminal currently inherits the canvas it casts yellow across every
  slot. A reduced-chroma cream keeps the paper and drops the cast.

Shape follows the ink-wash character: soft radius, 1px borders, and the 8%/14%
alpha borders replaced with values that actually read, per the `THEME.md`
guidance that a border rather than a value jump should separate surfaces.

### 4. Kanagawa Dragon: dark kept, light invented

Dark already measures clean. It gains the explicit terminal declaration, a border
that is not 8% alpha, and shape and emphasis.

Light is new and deliberately not Lotus. Dragon's language is muted,
near-monochrome, low-chroma ink, so its light counterpart is warm stone paper
with ink-grey text and the same restrained accent chroma, authored to the floors
from the start rather than corrected afterwards. `editorTheme` gains a light
pairing.

This is the section most likely to need revision on sight, since there is no
upstream reference to check it against.

### 5. Gruvbox: dissolve the invisible slot, then the floors

Dark: `terminal.background` becomes Gruvbox's own `dark0_hard #1d2021`, which
`THEME.md` already cites as the 6%-saturation exemplar. That single declaration
dissolves the ANSI-black collision, because `black #282828` is then distinct from
the background rather than identical to it. Red (2.69), blue (3.48) and magenta
(3.48) then rise to floor.

Light: `terminal.background` becomes `light0_hard #f9f5d7`, and slot 0 stops
being `#fbf1c7`. Canonical light Gruvbox maps `color0` onto the background, which
renders every `SGR 30` character invisible. `THEME.md` bans that outright and
decision 1 resolves it in favour of legibility. Green, yellow, cyan and white
rise, as do three brights, and `mutedForeground` darkens past 4.5.

Shape follows the chunky retro character: squarer radius, slightly heavier chrome
and panel borders, and an opaque border colour drawn from the palette instead of
an alpha wash.

## Verification

Order is test-first: the guard goes red, then each theme is brought to green one
at a time, in the order above.

Per theme:

- `pnpm test`
- Look at it running. `THEME.md`'s final checklist item is explicit that the
  tests catch dead and invisible colours but cannot say whether it looks good.
  The committed driver handles this:
  `node .claude/skills/run-terra/driver.mjs shot --theme <id> --mode <mode>`.

At the end: `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm knip`.

`src/modules/theme/__snapshots__/resolveTheme.test.ts.snap` will churn heavily,
including two new entries for terra-default. It is verified by diffing the
**entry set** and per-entry content, not by `git diff --numstat`, which
misreports interleaved snapshot edits as a wholesale rewrite.

## Out of scope

- `nothing/light` yellow (3.04) and `nothing/dark` red (4.24) are below floor.
  They are pre-existing and in a theme excluded from this work. Closing the guard
  hole will surface them as failures, so they have to be addressed for the suite
  to pass, but as a minimal contrast correction rather than a redesign.
- The four unmerged theme branches (dos, organic, poster, wireframe).
- Adopting `.terra-slot` and `.terra-control`, which still have no consumers.
