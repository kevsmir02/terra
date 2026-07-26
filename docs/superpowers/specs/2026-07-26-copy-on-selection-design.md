# Copy on Selection — Design

**Roadmap item:** `ROADMAP.md` → Coming next → *"Copy on Selection: Opt-in, off by default."*

**Goal:** When enabled, releasing a drag-selection in a terminal pane writes the selected text to the clipboard.

**Theme alignment:** *Terminal-first* — matches the copy-on-select convention of iTerm2, Windows Terminal, and X11 terminals.

---

## Problem

Selecting text in a terminal pane today requires a second action to copy it. `rendererPool.ts:266-271` already turns a selection into a clipboard write; it is only ever reached from a keyboard chord:

```ts
if (isTerminalCopy(event)) {
  if (event.type === "keydown" && slot.term.hasSelection()) {
    const sel = slot.term.getSelection();
    if (sel) void writeTerminalClipboard(sel);
  }
```

The feature is that same write on a different trigger. The complications are not in the copying.

### Complication 1: this overwrites the clipboard

On X11 the convention is non-destructive because copy-on-select writes the *primary selection*, a separate buffer pasted with middle-click. A webview cannot reach the primary selection, so `writeTerminalClipboard` (`terminalClipboard.ts:27`) writes the regular clipboard. Every drag-select would replace whatever the user last copied.

This is why the feature is opt-in and off by default, and why the settings copy must say so rather than describing the behavior neutrally.

### Complication 2: the existing drag test is one-dimensional

`TerminalPane.tsx:108-115` decides what a mouse-up means:

```tsx
onMouseUp={(e) => {
  const moved =
    downYRef.current != null &&
    Math.abs(e.clientY - downYRef.current) > 4;
  downYRef.current = null;
  if (!moved) session.selectBlockAt(e.clientY);
  if (session.blockMode === "prompt") focusLeafInput(leafId);
}}
```

`moved` is computed from `clientY` alone. A selection inside a single line — a filename, a commit hash, a URL, the most common thing anyone selects in a terminal — moves only horizontally and is therefore classified as *not moved*.

### Complication 3: the not-moved branch destroys the selection

`selectBlockAt` (`blockDecorations.ts:338-357`) resolves the clicked row to a command block and then either clears the selection or replaces it:

- no block under the pointer → `clearBlockSelection()` → `term.clearSelection()`
- block already selected → `clearBlockSelection()`
- otherwise → `selectBlock(id)` → `term.selectLines(start, end)`

Combined with complication 2, **this is a live bug independent of this feature**: drag-selecting text horizontally in a pane replaces that selection with the whole command block on mouse-up.

For copy-on-selection it is disqualifying. Gating the copy on `term.hasSelection()` alone would also be wrong in the opposite direction: a plain click that block-selects *creates* a selection, so a click would copy an entire command block.

---

## Goals

1. A drag-selection in a terminal pane copies to the clipboard when the preference is on.
2. The preference is off by default and its description states that it overwrites the clipboard.
3. A horizontal drag-selection is no longer replaced by a block selection.

## Non-goals

- **Middle-click paste.** The companion half of the X11 convention. A webview cannot read the primary selection, so there is nothing to paste from.
- **Copying on double-click or triple-click.** Word and line selection produce no drag. Ruled out deliberately: it is the case most likely to overwrite a clipboard by accident, and the copy keybinding still works for it. Revisit only if it is missed in daily use.
- **Per-line whitespace trimming** beyond rejecting a blank selection.
- **A separate primary-selection buffer** emulated inside the app.

---

## Architecture

Three units. The gesture logic is extracted rather than written inline because this repository has no jsdom or testing-library — React components and handlers cannot be unit-tested, so anything worth testing must be a pure function in `lib/` (the pattern used by `eol.ts`, `blockRange.ts`, and `devServerStore`'s `nextEntry`).

### 1. `src/modules/terminal/lib/copyOnSelect.ts` — gesture and selection rules

```ts
export const DRAG_THRESHOLD_PX = 4;

export type Point = { x: number; y: number };

/** True when the pointer moved far enough in either axis to count as a drag.
 *  A null origin (no matching mousedown) is never a drag. */
export function isDragGesture(
  from: Point | null,
  to: Point,
  threshold?: number,
): boolean;

/** The text worth copying, or null when the selection carries no content. */
export function selectionToCopy(raw: string): string | null;
```

`isDragGesture` keeps the existing 4px threshold and existing `null`-origin semantics, changing only that it measures both axes. It preserves the current strict comparison — movement must exceed the threshold, so a displacement of exactly 4px is *not* a drag — and is true when **either** axis exceeds it, not when the diagonal distance does.

`selectionToCopy` returns `null` for an empty or whitespace-only selection. Dragging across blank terminal rows yields row padding, and replacing the user's clipboard with a run of spaces is the worst possible expression of this feature. It returns the string unchanged otherwise — no trimming of meaningful content, since leading indentation is frequently the point of the selection.

### 2. `TerminalPane.tsx` — the trigger

`downYRef` becomes `downPtRef` holding `{ x, y }`, set on mouse-down. On mouse-up:

```
dragged = isDragGesture(downPt, { x: e.clientX, y: e.clientY })

if (dragged && copyOnSelect) → copy selectionToCopy(session.getSelection())
if (!dragged)                → session.selectBlockAt(e.clientY)
```

The two branches are mutually exclusive, which removes the ordering hazard from complication 3 by construction: the copy path can never observe a selection that `selectBlock` produced, because `selectBlockAt` only runs when there was no drag. No reordering or defensive snapshotting is needed.

The `blockMode === "prompt"` focus call at the end of the handler is unchanged and still runs on every mouse-up.

The pane reads the preference through `usePreferencesStore`, and the selection through the existing `session.getSelection()` (`useTerminalSession.ts:991`). Copying uses the existing `writeTerminalClipboard` (`terminalClipboard.ts:27`), which already carries the Linux-specific handling — WebKitGTK cannot read external copies, so the native plugin is used there and lazily imported to keep it out of the mac and Windows bundles.

### 3. `terminalCopyOnSelect` preference

Mirrors `terminalCursorBlink` exactly, which touches six places in `src/modules/settings/store.ts`:

| What | Reference |
|---|---|
| Field on the preferences type | `store.ts:114` |
| `KEY_TERMINAL_COPY_ON_SELECT` storage-key constant | `store.ts:180` |
| `DEFAULT_PREFERENCES` entry, `false` | `store.ts:239` |
| Load coercion, `get<boolean>(KEY) ?? DEFAULT` | `store.ts:321-323` |
| Storage-key → field map entry | `store.ts:627` |
| `setTerminalCopyOnSelect` writing via `writePref` | `store.ts:486` |

Plus a `SettingRow` with a `Switch` in `GeneralSection.tsx`, placed directly after the existing "Cursor blinking" row.

Copy for that row:

> **Title:** Copy on selection
> **Description:** Copies selected text to the clipboard when you finish dragging. This replaces the clipboard's current contents — Terra cannot use the Linux primary selection, which is what makes this non-destructive in other terminals.

The second sentence is load-bearing. A user enabling this without knowing it clobbers their clipboard will lose something they copied.

---

## Behavior

| Gesture | Preference off | Preference on |
|---|---|---|
| Click on a command block | Block selected | Block selected (unchanged) |
| Click on empty area | Block selection cleared | Cleared (unchanged) |
| Horizontal drag over text | **Selection replaced by block** (bug) | Selection kept, text copied |
| Vertical drag over text | Selection kept | Selection kept, text copied |
| Drag over blank rows | Selection kept | Selection kept, **nothing copied** |
| Double / triple click | Word or line selected | Selected, not copied |

The horizontal-drag row is the pre-existing bug this design fixes. Its fix lands in the shared `!dragged` gate, so it applies whether or not the preference is enabled.

## Error handling

`writeTerminalClipboard` already swallows failures on both its paths — a denied clipboard permission or a missing plugin leaves the selection on screen and writes nothing. That is the correct behavior for a passive convenience feature: a toast on every failed drag would be worse than silence. No new error handling is introduced.

## Testing

`src/modules/terminal/lib/copyOnSelect.test.ts`:

- `isDragGesture` — movement below and above threshold; X-only movement (the case the old Y-only test missed); Y-only movement; exact-threshold boundary; `null` origin returns false.
- `selectionToCopy` — returns null for `""` and for whitespace-only input; preserves leading indentation; returns multi-line content unchanged.

Not testable here: the handler wiring and the preference round-trip, both of which need a DOM. Covered by the manual check below instead of pretending otherwise.

**Manual verification:** with the preference on, drag-select a filename within one line and confirm it both stays selected and lands in the clipboard; drag across blank rows and confirm the clipboard is untouched; click a command block and confirm block selection still works and did not copy; turn the preference off and confirm dragging no longer copies while block selection still behaves.

## Success criteria

1. With the preference on, a drag-selection is on the clipboard at mouse-up.
2. With it off, behavior is identical to today except that horizontal drag-selections survive.
3. Blank selections never touch the clipboard.
4. `pnpm test`, `pnpm check-types`, and `pnpm lint` pass.
