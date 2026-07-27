# Rebindable Terminal Keys & Shortcut Conflict Detection

Two adjacent ROADMAP items, designed together because the second is what makes
the first safe:

- **Rebindable Terminal Keys** — terminal copy, paste, and Shift+Enter are
  hardcoded in the xterm key handler and bypass the shortcut system that already
  covers the other 40 actions.
- **Shortcut Conflict Detection** — binding a chord already claimed by another
  action silently shadows it; the shortcut editor should surface the clash while
  recording.

## Current state

`rendererPool.ts:238` attaches one `attachCustomKeyEventHandler` per renderer
slot. It runs, in order:

1. IME guard — `event.isComposing || event.keyCode === 229` bails out, so the
   Enter that commits a pinyin or jamo candidate never reaches the PTY.
2. `terminalReadlineSequence` from `keymap.ts` — Alt+arrows, ⌘+arrows,
   modifier+Backspace.
3. Shift+Enter → writes `\x1b\r` to the PTY.
4. Ctrl+Shift+C → copy selection.
5. Ctrl+Shift+V → paste.

Steps 3-5 are the hardcoded predicates at `rendererPool.ts:1032-1058`. Copy and
paste are gated behind `!IS_MAC`, so on macOS ⌘C/⌘V fall through to the
webview's native clipboard handling.

The shortcut system these bypass:

```
SHORTCUTS[]  →  useGlobalShortcuts  →  isDisabled gating  →  preferences.shortcuts
(shortcuts.ts)   (window keydown,       (App.tsx:729)          (store.ts, synced
                  capture phase)                                cross-window)
                                     ↘  ShortcutsSection.tsx (recorder UI)
```

## Decisions

| Question | Decision |
| --- | --- |
| Scope | The three named keys only. The `keymap.ts` readline remaps stay hardcoded. |
| macOS defaults | Empty binding arrays; rows still visible and bindable. ⌘C/⌘V stay native. |
| Conflict UX | Two-step record: capture the chord, preview it with any clash, apply on Enter. |
| Dispatch | Bindings live in `SHORTCUTS`; dispatch stays in `rendererPool`. |

### Why dispatch stays in the pool

Moving these three into `useGlobalShortcuts` would give one dispatch path for
all 43 actions, but it pays for that in three places:

- **`useGlobalShortcuts` has no IME guard.** Shift+Enter dispatched from the
  global listener would fire mid-composition. Adding the guard there changes
  behavior for all 40 existing actions.
- **The pool handler closes over `slot`**, so `slot.term.getSelection()` and
  `slot.term.paste()` are in scope. A global handler would have to resolve which
  terminal is focused; the pool is the authority (`adapter.isLeafFocused`), not
  `App.tsx`.
- **`useGlobalShortcuts` calls `preventDefault()` unconditionally** before
  invoking a handler, so "matched but declined to act" — which copy-with-no-
  selection and every unbound chord need — isn't expressible without changing
  the handler protocol.

Keeping dispatch in the pool works because of an existing dispatcher property:
on a match with no registered handler, `useGlobalShortcuts.ts:35` returns
*without* `preventDefault`, so the event flows on to xterm's textarea and reaches
the pool handler. This is the same mechanism the display-only `editor.*` entries
rely on.

The tradeoff accepted: two dispatch paths, and the global capture listener still
runs first — so a terminal key bound to a chord another action owns loses to that
action. That is exactly what the conflict detector surfaces.

A third option — a separate `terminalKeys` preference outside `SHORTCUTS` — was
rejected because it forfeits the Settings UI, the persistence, and the conflict
detector, which is most of the value.

## Part 1 — Rebindable terminal keys

### Shortcut table entries

Three entries added to `SHORTCUTS` in group `Terminal` (the group and its
`SHORTCUT_GROUPS` entry already exist, so no UI change is needed):

```ts
{ id: "terminal.copy",    label: "Copy selection",
  defaultBindings: IS_MAC ? [] : [{ ctrl: true, shift: true, key: "c" }] },
{ id: "terminal.paste",   label: "Paste into terminal",
  defaultBindings: IS_MAC ? [] : [{ ctrl: true, shift: true, key: "v" }] },
{ id: "terminal.newline", label: "Insert newline without submitting",
  defaultBindings: [{ shift: true, key: "Enter" }] },
```

These reproduce today's behavior exactly: `IS_MAC ? []` mirrors the current
`!IS_MAC &&` guard, and Shift+Enter has always been cross-platform.

No `allowRepeat` flag. The pool never consults it, and held Shift+Enter keeps
repeating because both dispatcher branches — `e.repeat && !allowRepeat` →
`continue`, and matched-but-unhandled → `return` without `preventDefault` — let
every keydown reach the pool.

### Pure matcher

New in `keymap.ts`, beside `terminalReadlineSequence`:

```ts
export type TerminalKeyAction = "copy" | "paste" | "newline";

export function terminalKeyAction(
  event: TerminalKeyEvent,
  bindings: Record<TerminalKeyAction, KeyBinding[]>,
): TerminalKeyAction | null;
```

It delegates chord comparison to `matchBinding` rather than reimplementing it,
which picks up the Alt-rewrites-`e.key` → `e.code` fallback at
`shortcuts.ts:393` that the current `e.code === "KeyC" || e.key === "c"`
predicates only half-cover.

Two contained type changes this forces:

- `TerminalKeyEvent` is `Pick<KeyboardEvent, "altKey"|"ctrlKey"|"metaKey"|"key"|"code">`
  — it is missing `shiftKey`, which every one of these bindings needs. Add it,
  and add `shiftKey: false` to the `evt` factory at `keymap.test.ts:11`.
- `matchBinding` takes a full `KeyboardEvent`. Widen its first parameter to a
  structural `KeyEventLike =
  Pick<KeyboardEvent, "key"|"code"|"ctrlKey"|"shiftKey"|"altKey"|"metaKey">` so
  `keymap.ts` can call it. `KeyboardEvent` is assignable to that, so all existing
  callers and `shortcuts.test.ts` are unaffected.

### Binding delivery

The handler reads the current bindings at the point of use:

```ts
const action = terminalKeyAction(
  event,
  resolveTerminalKeyBindings(usePreferencesStore.getState().shortcuts),
);
```

`rendererPool.ts` already reads preferences this way at four sites — lines 620,
757, 979, and 170 — so this needs no new state, no exported setter, and no
subscription. A rebind is picked up on the very next keystroke.

The alternative considered was the `applyXPreference` push used by
`applyScrollback` and `applyWebglPreference`: module-level binding state plus a
`useTerminalSession` effect. It was rejected as more machinery for the same
result. The push pattern earns its keep when the pool must *act* on a change
(refit, reattach WebGL, reset scrollback); a chord table only needs to be
correct when read, and the key handler is the only reader.

Resolution is not memoised. `resolveTerminalKeyBindings` is three map lookups
and a small object literal, against a handler that already does more work than
that on every keydown.

Resolution must use `??`, not a truthiness check that would treat `[]` as
missing: a cleared row is stored as an empty array, and it has to survive
resolution rather than fall back to the default. That empty array is what makes
"Unassigned" mean unassigned. Before the store hydrates, `shortcuts` is `{}` and
resolution yields the factory defaults, which is correct.

Cross-window propagation already works: `writePref` mirrors every setter through
`PREFS_CHANGED_EVENT` (`store.ts:275`) and `preferences.ts` re-hydrates the
zustand store from it, so a rebind in the Settings window reaches the main
window live without a restart.

### Rewritten handler

`rendererPool.ts:238` becomes: IME guard → `terminalKeyAction` →
`terminalReadlineSequence` → `return true`. The predicates at lines 1032-1058
are deleted.

**Order change:** user-configured bindings are checked *before* the hardcoded
readline remaps, so an explicit binding wins over an implicit default. The
shipped defaults do not overlap, so nothing changes out of the box.

**Two behaviors preserved deliberately:**

- Copy with no selection still swallows the key (`preventDefault`,
  `return false`). Falling through would hand Ctrl+Shift+C to xterm, which can
  emit `\x03` and SIGINT a running job — strictly worse than doing nothing.
- An empty binding array falls through to xterm. That is what leaves macOS
  ⌘C/⌘V on the webview's native path, and what a user gets after clearing a row.

## Part 2 — Shortcut conflict detection

### Pure resolver

New `src/modules/shortcuts/lib/shortcutConflicts.ts`, beside the existing
`shortcutScope.ts`:

```ts
/** Chord equality — normalizes key case and coerces absent modifiers. */
export function sameBinding(a: KeyBinding, b: KeyBinding): boolean;

/** Ids other than `self` whose active bindings (user override ?? default)
 *  already claim this chord. */
export function conflictingShortcuts(
  binding: KeyBinding,
  self: ShortcutId,
  user: Partial<Record<ShortcutId, KeyBinding[]>>,
): ShortcutId[];
```

Normalization is load-bearing: `Recorder` stores `e.key` raw, saving `"C"`,
`"Enter"`, `"ArrowUp"`, while the defaults table is authored lowercase. A naive
`===` would miss the most common clash. `sameBinding` lowercases the key and
`!!`-coerces all four modifier flags, matching `shortcuts.ts:396-401`.

Two cases a "compare against `bindings[0]`" check would miss:

- **Shortcuts with multiple bindings.** `sidebar.toggle` owns Mod+B *and*
  Mod+Shift+B; `view.zoomIn` and `view.zoomOut` each own two. The resolver
  iterates every binding of every shortcut.
- **`tab.selectByIndex` claims nine chords, not one.** Its default is
  `{ ctrl: true, key: "1" }`, but `matchBinding` special-cases it at
  `shortcuts.ts:390` to match any digit 1-9. Binding something to Mod+5 is
  therefore silently shadowed even though no entry visibly holds Mod+5 — and the
  row is filtered out of the Settings list (`ShortcutsSection.tsx:41`), so the
  user cannot see what it clashes with. `conflictingShortcuts` mirrors the
  special case.

### Why every duplicate counts as a conflict

`useGlobalShortcuts.ts:29-41` is first-match-wins and uses `return`, not
`continue`, on both the `isDisabled` and no-handler branches. A duplicate chord
therefore shadows even when the two actions are scoped to different surfaces
(editor vs terminal). Flagging every duplicate matches real runtime behavior, so
scope gating is deliberately not consulted.

Changing the dispatcher to `continue` would relax this and let scoped duplicates
coexist, but it is a behavior change across all 43 actions and belongs in its own
change. Out of scope here.

The default bindings of all 40 current shortcuts were enumerated on both
platforms: there are no existing collisions, so a flag-all rule ships with zero
false positives.

### Two-step Recorder

`Recorder` gains `pending: KeyBinding | null`. A captured chord sets `pending`
instead of calling `onRecord`. The panel then renders the chord as `<Kbd>`
tokens via `getBindingTokens`, the conflict line if any — `Already used by` plus
the clashing actions' labels, comma-joined when there is more than one — and
`Enter to apply · Esc to cancel`, plus
clickable Apply and Cancel controls since the user may have arrived by mouse.

**Enter is both the apply key and part of a valid chord** — Shift+Enter is the
new default for `terminal.newline`. `onDown` therefore orders its checks:

1. Enter with no modifiers → apply `pending`.
2. Escape → cancel.
3. Otherwise run the existing capture guard and *replace* `pending`, letting the
   user re-try without leaving the recorder.

Claiming bare Enter is safe because the existing guard at
`ShortcutsSection.tsx:290` already rejects it (no primary modifier, no shift).

Conflicts are surfaced but **not blocking** — Apply stays enabled. A deliberate
reassignment (take Ctrl+Shift+F from `explorer.search`, then go clear that row)
has to remain possible.

### Persistent row warnings

`ShortcutRow` also renders a warning when its *saved* bindings conflict, reusing
`conflictingShortcuts`. Two-step recording can only catch clashes created from
now on; it cannot surface a duplicate a user saved before this shipped, which is
exactly the config most likely to be broken.

## Testing

Tests run in the bare vitest node environment — no RTL, no jsdom — so component
behavior is verified manually.

### `keymap.test.ts` (extended)

The `evt` factory at line 11 gains `shiftKey: false`. New cases for
`terminalKeyAction`:

- each of copy / paste / newline matches its bound chord
- an empty binding array matches nothing — the macOS path and the cleared-row
  path, so the most important case
- exact modifier matching: Ctrl+C does not trigger `terminal.copy` when the
  binding is Ctrl+Shift+C
- an unrelated key returns `null`, so the handler falls through to
  `terminalReadlineSequence`

The Alt/`e.code` fallback needs no new test — `shortcuts.test.ts:82` already
covers it inside `matchBinding`.

### `shortcutConflicts.test.ts` (new)

- `sameBinding` — key case-insensitivity (`"C"` from the Recorder vs `"c"` from
  the table), absent-vs-`false` modifier equivalence, differing modifier → false
- `conflictingShortcuts` — finds a clash against a factory default; excludes
  `self`; honors user overrides in both directions (an override frees the chord
  it replaced and claims the new one); matches non-first bindings via
  `sidebar.toggle`'s Mod+Shift+B; an empty array claims nothing
- the `tab.selectByIndex` special case — Mod+5 conflicts, Mod+0 does not
- **guard test:** iterate `SHORTCUTS` and assert
  `conflictingShortcuts(b, s.id, {})` is empty for every binding of every entry,
  so a colliding default added later fails CI

`IS_MAC` resolves false in the node env (documented at `shortcuts.test.ts:5`), so
the guard above covers the non-mac table. Because this change makes the table
platform-conditional for the first time in a way that matters, a second variant
runs the same assertion against the mac table via `vi.mock("@/lib/platform", …)`
plus `vi.resetModules()` and a dynamic re-import — the pattern
`terminalClipboard.test.ts:25` already uses.

### Manual verification

- the pool handler wiring itself: it lives inside `createSlot`'s closure over
  `slot` and is not reachable without restructuring the pool. Extracting it is a
  bigger change than this feature warrants; the decision logic is what was
  extracted into `terminalKeyAction`, and that is tested.
- handler precedence — user bindings consulted before the readline remaps. This
  ordering exists only in the handler's call sequence, not in any pure function.
- a rebind in the Settings window taking effect in the main window with no
  restart
- IME: Shift+Enter must not reach the PTY mid-composition (`keyCode === 229`)
- the two-step Recorder flow, including bare-Enter-applies vs
  Shift+Enter-recaptures
- macOS: ⌘C/⌘V still copy and paste with both rows unassigned

## Files

| File | Change |
| --- | --- |
| `src/modules/shortcuts/shortcuts.ts` | 3 new `SHORTCUTS` entries; widen `matchBinding` to `KeyEventLike` |
| `src/modules/shortcuts/lib/shortcutConflicts.ts` | New — `sameBinding`, `conflictingShortcuts` |
| `src/modules/shortcuts/lib/shortcutConflicts.test.ts` | New |
| `src/modules/shortcuts/index.ts` | Re-export the conflict helpers |
| `src/modules/terminal/lib/keymap.ts` | `terminalKeyAction`; `shiftKey` on `TerminalKeyEvent` |
| `src/modules/terminal/lib/keymap.test.ts` | `shiftKey` in `evt`; `terminalKeyAction` cases |
| `src/modules/terminal/lib/rendererPool.ts` | Rewrite handler at 238; delete 1032-1058 |
| `src/settings/sections/ShortcutsSection.tsx` | Two-step `Recorder`; conflict warnings on rows |
| `ROADMAP.md` | Move both entries from Planned to Shipped |

`App.tsx` is deliberately unchanged: under this design the three terminal keys
register no global handler.

## Out of scope

- The `keymap.ts` readline remaps (Alt+arrows, ⌘+arrows, modifier+Backspace)
  stay hardcoded.
- Making `useGlobalShortcuts` `continue` instead of `return` so scoped duplicates
  can coexist.
- A configurable escape sequence for `terminal.newline`; it stays `\x1b\r`.
- Extracting the pool key handler out of `createSlot` for direct testing.
