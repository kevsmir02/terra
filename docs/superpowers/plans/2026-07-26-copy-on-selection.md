# Copy on Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an opt-in preference is on, releasing a drag-selection in a terminal pane copies the selected text to the clipboard.

**Architecture:** A pure `copyOnSelect.ts` module decides what counts as a drag and what is worth copying. `TerminalPane`'s existing mouse-up handler gains a two-branch split — drag copies, non-drag block-selects — which also fixes a pre-existing bug where horizontal drag-selections were replaced by a block selection. A `terminalCopyOnSelect` boolean follows the established `terminalCursorBlink` preference pattern.

**Tech Stack:** TypeScript, React 19, xterm.js, zustand, vitest, Tauri clipboard plugin.

**Spec:** `docs/superpowers/specs/2026-07-26-copy-on-selection-design.md`

## Global Constraints

- **No new dependencies.** Everything uses packages already in `package.json`.
- **Tests are pure-function only.** This repo has no jsdom or testing-library, so React components and handlers cannot be unit-tested. Anything worth testing must be a pure function in a `lib/` module — the pattern used by `eol.ts`, `blockRange.ts`, and `devServerStore`'s `nextEntry`.
- **Threshold semantics are strict and per-axis:** movement must *exceed* 4px, so exactly 4px is not a drag; the test is `dx > threshold || dy > threshold`, never diagonal distance.
- **The preference defaults to `false`** and must never be enabled implicitly.
- **The settings description must state that it overwrites the clipboard.** Exact copy is given in Task 3, Step 5; do not reword it. A user who enables this without knowing loses whatever they last copied.
- **Blank selections must never reach the clipboard.**
- Lint and types must stay clean: `pnpm lint && pnpm check-types`.
- **Out of scope:** middle-click paste, copying on double/triple-click, per-line whitespace trimming, emulating a primary-selection buffer.

---

## File Structure

**Create**
- `src/modules/terminal/lib/copyOnSelect.ts` — the drag test and the selection filter. Pure; no React, no xterm, no Tauri.
- `src/modules/terminal/lib/copyOnSelect.test.ts` — unit tests for both functions.

**Modify**
- `src/modules/settings/store.ts` — six touchpoints for the new boolean preference.
- `src/settings/sections/GeneralSection.tsx` — the settings row.
- `src/modules/terminal/TerminalPane.tsx:55` (ref) and `:105-115` (handlers) — the trigger.

Task order matters: the pure module lands first so the pane can consume it, and the preference lands before the pane so the pane can read it. Task 4 is the only task that changes user-visible behavior.

---

### Task 1: The gesture and selection rules

Pure logic. Nothing else in the codebase changes and nothing consumes it yet.

**Files:**
- Create: `src/modules/terminal/lib/copyOnSelect.ts`
- Test: `src/modules/terminal/lib/copyOnSelect.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const DRAG_THRESHOLD_PX = 4`
  - `export type Point = { x: number; y: number }`
  - `export function isDragGesture(from: Point | null, to: Point, threshold?: number): boolean`
  - `export function selectionToCopy(raw: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/terminal/lib/copyOnSelect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  isDragGesture,
  selectionToCopy,
} from "./copyOnSelect";

describe("isDragGesture", () => {
  it("treats a still pointer as a click", () => {
    expect(isDragGesture({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });

  it("treats horizontal movement as a drag", () => {
    // The case the old clientY-only check missed: selecting a filename or a
    // hash inside one line never changes y.
    expect(isDragGesture({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(true);
  });

  it("treats vertical movement as a drag", () => {
    expect(isDragGesture({ x: 10, y: 10 }, { x: 10, y: 40 })).toBe(true);
  });

  it("treats movement in either direction as a drag", () => {
    expect(isDragGesture({ x: 40, y: 40 }, { x: 10, y: 40 })).toBe(true);
    expect(isDragGesture({ x: 40, y: 40 }, { x: 40, y: 10 })).toBe(true);
  });

  it("requires movement to exceed the threshold, not merely reach it", () => {
    const from = { x: 0, y: 0 };
    expect(isDragGesture(from, { x: DRAG_THRESHOLD_PX, y: 0 })).toBe(false);
    expect(isDragGesture(from, { x: DRAG_THRESHOLD_PX + 1, y: 0 })).toBe(true);
  });

  it("does not combine axes into a diagonal distance", () => {
    // 4px on each axis is 5.7px diagonally but is not a drag: each axis is
    // judged on its own, matching the original single-axis check.
    expect(isDragGesture({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
  });

  it("is never a drag without a recorded origin", () => {
    expect(isDragGesture(null, { x: 999, y: 999 })).toBe(false);
  });

  it("honours an explicit threshold", () => {
    expect(isDragGesture({ x: 0, y: 0 }, { x: 8, y: 0 }, 20)).toBe(false);
  });
});

describe("selectionToCopy", () => {
  it("returns the selected text", () => {
    expect(selectionToCopy("src/main.tsx")).toBe("src/main.tsx");
  });

  it("rejects an empty selection", () => {
    expect(selectionToCopy("")).toBeNull();
  });

  it("rejects a whitespace-only selection", () => {
    // Dragging across blank terminal rows yields row padding; replacing the
    // clipboard with spaces is the worst version of this feature.
    expect(selectionToCopy("   \n \t ")).toBeNull();
  });

  it("preserves leading indentation, which is often the point", () => {
    expect(selectionToCopy("    indented")).toBe("    indented");
  });

  it("preserves multi-line content verbatim", () => {
    expect(selectionToCopy("line one\nline two\n")).toBe("line one\nline two\n");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/modules/terminal/lib/copyOnSelect.test.ts`
Expected: FAIL — `Failed to resolve import "./copyOnSelect"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/terminal/lib/copyOnSelect.ts`:

```ts
/** Pointer travel, in CSS pixels, that separates a click from a drag. Carried
 *  over from the original mouse-up handler so click behaviour is unchanged. */
export const DRAG_THRESHOLD_PX = 4;

export type Point = { x: number; y: number };

/**
 * True when the pointer moved far enough to count as a drag-selection.
 *
 * Each axis is judged on its own rather than by diagonal distance: the handler
 * this replaces compared only `clientY`, which classified a selection inside a
 * single line — a filename, a hash, a URL — as a click. A null origin means no
 * matching mousedown was seen, which is never a drag.
 */
export function isDragGesture(
  from: Point | null,
  to: Point,
  threshold: number = DRAG_THRESHOLD_PX,
): boolean {
  if (from === null) return false;
  return (
    Math.abs(to.x - from.x) > threshold || Math.abs(to.y - from.y) > threshold
  );
}

/**
 * The text worth putting on the clipboard, or null when the selection carries
 * no content. Content is returned unchanged — leading indentation is frequently
 * what the user is selecting — but a selection of only whitespace is dropped,
 * since dragging across blank rows picks up row padding and would otherwise
 * silently replace the clipboard with spaces.
 */
export function selectionToCopy(raw: string): string | null {
  return raw.trim().length === 0 ? null : raw;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/modules/terminal/lib/copyOnSelect.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Verify types and lint**

Run: `pnpm check-types && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/terminal/lib/copyOnSelect.ts src/modules/terminal/lib/copyOnSelect.test.ts
git commit -m "feat(terminal): add drag-gesture and selection rules for copy on select"
```

---

### Task 2: The `terminalCopyOnSelect` preference

Storage and setter only. Nothing reads it yet, so this task changes no behaviour.

**Files:**
- Modify: `src/modules/settings/store.ts` (six sites)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `terminalCopyOnSelect: boolean` on the preferences type, readable via `usePreferencesStore((s) => s.terminalCopyOnSelect)`
  - `export async function setTerminalCopyOnSelect(value: boolean): Promise<void>`
  - Default value `false`.

Each site below already contains the matching `terminalCursorBlink` line; add the new one directly after it, so the two stay adjacent everywhere.

- [ ] **Step 1: Add the field to the preferences type**

In `src/modules/settings/store.ts`, find line 114:

```ts
  terminalCursorBlink: boolean;
```

Add directly below it:

```ts
  terminalCopyOnSelect: boolean;
```

- [ ] **Step 2: Add the storage-key constant**

Find line 180:

```ts
const KEY_TERMINAL_CURSOR_BLINK = "terminalCursorBlink";
```

Add directly below it:

```ts
const KEY_TERMINAL_COPY_ON_SELECT = "terminalCopyOnSelect";
```

- [ ] **Step 3: Add the default**

Find line 239 inside `DEFAULT_PREFERENCES`:

```ts
  terminalCursorBlink: false,
```

Add directly below it:

```ts
  terminalCopyOnSelect: false,
```

- [ ] **Step 4: Add the load coercion**

Find this block around lines 321-323:

```ts
    terminalCursorBlink:
      get<boolean>(KEY_TERMINAL_CURSOR_BLINK) ??
      DEFAULT_PREFERENCES.terminalCursorBlink,
```

Add directly below it:

```ts
    terminalCopyOnSelect:
      get<boolean>(KEY_TERMINAL_COPY_ON_SELECT) ??
      DEFAULT_PREFERENCES.terminalCopyOnSelect,
```

- [ ] **Step 5: Add the storage-key to field mapping**

Find line 627:

```ts
    [KEY_TERMINAL_CURSOR_BLINK]: "terminalCursorBlink",
```

Add directly below it:

```ts
    [KEY_TERMINAL_COPY_ON_SELECT]: "terminalCopyOnSelect",
```

- [ ] **Step 6: Add the setter**

Find this function around line 486:

```ts
export async function setTerminalCursorBlink(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_CURSOR_BLINK, value);
}
```

Add directly below it:

```ts
export async function setTerminalCopyOnSelect(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_COPY_ON_SELECT, value);
}
```

- [ ] **Step 7: Verify types, lint, and the existing suite**

Run: `pnpm check-types && pnpm lint && pnpm test`

Expected: all pass. A missing field on the preferences type surfaces here as a
type error on the `DEFAULT_PREFERENCES` object, so a clean `check-types` is the
proof that all six sites are consistent.

- [ ] **Step 8: Commit**

```bash
git add src/modules/settings/store.ts
git commit -m "feat(settings): add the terminalCopyOnSelect preference"
```

---

### Task 3: The settings row

**Files:**
- Modify: `src/settings/sections/GeneralSection.tsx` (import, selector, row)

**Interfaces:**
- Consumes: `setTerminalCopyOnSelect` and the `terminalCopyOnSelect` field from Task 2.
- Produces: a user-visible toggle. Nothing consumes this task's output.

- [ ] **Step 1: Import the setter**

In `src/settings/sections/GeneralSection.tsx`, the import block from
`@/modules/settings/store` lists setters alphabetically. Find:

```ts
  setTerminalCursorBlink,
```

Add directly **above** it, keeping alphabetical order (`CopyOnSelect` sorts
before `CursorBlink`):

```ts
  setTerminalCopyOnSelect,
```

- [ ] **Step 2: Read the preference**

Find line 87:

```ts
  const terminalCursorBlink = usePreferencesStore((s) => s.terminalCursorBlink);
```

Add directly below it:

```ts
  const terminalCopyOnSelect = usePreferencesStore(
    (s) => s.terminalCopyOnSelect,
  );
```

- [ ] **Step 3: Add the settings row**

Find the "Cursor blinking" `SettingRow` (around lines 245-255):

```tsx
        <SettingRow
          title="Cursor blinking"
          description="Blink the terminal cursor. Off by default for lower idle CPU, matching VS Code and the macOS terminal."
        >
          <Switch
            checked={terminalCursorBlink}
            onCheckedChange={(v) => void setTerminalCursorBlink(v)}
          />
        </SettingRow>
```

Add this new row directly below it. **Use this description verbatim** — the
second sentence is the whole reason the feature is opt-in:

```tsx
        <SettingRow
          title="Copy on selection"
          description="Copies selected text to the clipboard when you finish dragging. This replaces the clipboard's current contents — Terra cannot use the Linux primary selection, which is what makes this non-destructive in other terminals."
        >
          <Switch
            checked={terminalCopyOnSelect}
            onCheckedChange={(v) => void setTerminalCopyOnSelect(v)}
          />
        </SettingRow>
```

- [ ] **Step 4: Verify types and lint**

Run: `pnpm check-types && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Verify the toggle persists**

Run `pnpm tauri dev`, open Settings → General, and confirm the "Copy on
selection" row appears below "Cursor blinking" and is **off**. Toggle it on,
close the Settings window, reopen it, and confirm it is still on. Toggle it
back off before continuing — Task 4 tests both states.

Nothing acts on the preference yet, so this only proves storage.

- [ ] **Step 6: Commit**

```bash
git add src/settings/sections/GeneralSection.tsx
git commit -m "feat(settings): add the copy-on-selection toggle"
```

---

### Task 4: Wire the trigger and fix the block-selection gate

The only task that changes behaviour. It does two things that must land
together: it adds the copy, and it widens the existing drag test from one axis
to two. Splitting them would leave the copy firing on selections that
`selectBlockAt` immediately replaces.

**Files:**
- Modify: `src/modules/terminal/TerminalPane.tsx` — imports, `:55` (ref), `:105-115` (handlers)

**Interfaces:**
- Consumes: `isDragGesture`, `selectionToCopy`, `type Point` from Task 1; `terminalCopyOnSelect` from Task 2; the existing `session.getSelection()` (`useTerminalSession.ts:991`) and `writeTerminalClipboard` (`terminalClipboard.ts:27`).
- Produces: no new exports.

- [ ] **Step 1: Add the imports**

In `src/modules/terminal/TerminalPane.tsx`, the file currently opens with:

```ts
import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
```

Change those two lines to:

```ts
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
```

Then find the relative imports at the end of the import block:

```ts
import { BlockOverlay } from "./block/BlockOverlay";
import { BlockWatermark } from "./block/BlockWatermark";
import {
  focusLeafInput,
  submitToLeaf,
  useTerminalSession,
} from "./lib/useTerminalSession";
```

Insert the two new imports between `BlockWatermark` and the
`useTerminalSession` block, so the whole run stays sorted
(`./block/…` before `./lib/copyOnSelect` before `./lib/terminalClipboard`
before `./lib/useTerminalSession`):

```ts
import { BlockOverlay } from "./block/BlockOverlay";
import { BlockWatermark } from "./block/BlockWatermark";
import {
  isDragGesture,
  type Point,
  selectionToCopy,
} from "./lib/copyOnSelect";
import { writeTerminalClipboard } from "./lib/terminalClipboard";
import {
  focusLeafInput,
  submitToLeaf,
  useTerminalSession,
} from "./lib/useTerminalSession";
```

- [ ] **Step 2: Widen the mousedown ref to two axes**

Find line 55:

```ts
    const downYRef = useRef<number | null>(null);
```

Replace it with:

```ts
    const downPtRef = useRef<Point | null>(null);
```

- [ ] **Step 3: Read the preference**

Directly below the `downPtRef` line added in Step 2, add:

```ts
    const copyOnSelect = usePreferencesStore((s) => s.terminalCopyOnSelect);
```

- [ ] **Step 4: Replace the mouse handlers**

Find this block (around lines 105-115):

```tsx
              onMouseDown={(e) => {
                downYRef.current = e.clientY;
              }}
              onMouseUp={(e) => {
                const moved =
                  downYRef.current != null &&
                  Math.abs(e.clientY - downYRef.current) > 4;
                downYRef.current = null;
                if (!moved) session.selectBlockAt(e.clientY);
                if (session.blockMode === "prompt") focusLeafInput(leafId);
              }}
```

Replace it with:

```tsx
              onMouseDown={(e) => {
                downPtRef.current = { x: e.clientX, y: e.clientY };
              }}
              onMouseUp={(e) => {
                const dragged = isDragGesture(downPtRef.current, {
                  x: e.clientX,
                  y: e.clientY,
                });
                downPtRef.current = null;
                // The two branches are mutually exclusive on purpose:
                // selectBlockAt replaces the selection with whole-block lines,
                // so the copy path must never run where it could observe that.
                if (dragged) {
                  if (copyOnSelect) {
                    const text = selectionToCopy(session.getSelection() ?? "");
                    if (text) void writeTerminalClipboard(text);
                  }
                } else {
                  session.selectBlockAt(e.clientY);
                }
                if (session.blockMode === "prompt") focusLeafInput(leafId);
              }}
```

- [ ] **Step 5: Verify types, lint, and the existing suite**

Run: `pnpm check-types && pnpm lint && pnpm test`

Expected: all pass. `check-types` catches any remaining `downYRef` reference,
which is the likeliest mistake in this task.

- [ ] **Step 6: Confirm no stale reference survived**

Run: `grep -rn "downYRef" src/`
Expected: no output.

- [ ] **Step 7: Manual verification — the fix, with the preference OFF**

Run `pnpm tauri dev` with "Copy on selection" **off**, then in a terminal pane:

1. Run a command so a command block exists (e.g. `ls -la`).
2. Drag-select a filename *within one line*. Confirm the selection **stays put** and is not replaced by a whole-block highlight. This is the pre-existing bug being fixed; before this change the selection jumped to the whole block.
3. Click once on a command block. Confirm block selection still works.
4. Click the same block again. Confirm the block selection clears.
5. Click on empty area below all output. Confirm any block selection clears.
6. Paste into an editor and confirm the clipboard was **not** touched by any of the above.

- [ ] **Step 8: Manual verification — the feature, with the preference ON**

Turn "Copy on selection" on in Settings → General, then:

1. Copy a known sentinel string (e.g. `SENTINEL`) from an editor so the clipboard has a known value.
2. Drag-select a filename within one line in the terminal. Paste elsewhere and confirm you get the filename, not `SENTINEL`.
3. Drag-select across several lines. Paste and confirm all lines arrive.
4. Copy `SENTINEL` again, then drag across a blank region below all output. Paste and confirm you still get `SENTINEL` — a whitespace-only selection must not reach the clipboard.
5. Copy `SENTINEL` again, then single-click a command block. Paste and confirm you still get `SENTINEL` — a click block-selects but must not copy.
6. Copy `SENTINEL` again, then double-click a word. Confirm the word highlights and pasting still yields `SENTINEL` — click-selection copying is deliberately out of scope.
7. Split the pane and repeat step 2 in the second pane, confirming the behaviour is per-pane.

- [ ] **Step 9: Commit**

```bash
git add src/modules/terminal/TerminalPane.tsx
git commit -m "feat(terminal): copy the selection on drag release when enabled"
```

---

### Task 5: Move the roadmap entry to shipped

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Remove the planned entry**

In `ROADMAP.md`, under `### Coming next`, delete this line:

```markdown
- [ ] **Copy on Selection**: Opt-in, off by default. Writing the selection to the clipboard on mouse-up clobbers whatever the user had copied, since a webview cannot reach the X11 primary selection that makes this non-destructive on Linux.
```

- [ ] **Step 2: Add the shipped entry**

Under `### Terminal & Spaces` in the Shipped section, add after the
`- [x] Drag and drop in terminal (files as quoted paths)` line:

```markdown
- [x] **Copy on Selection**: Opt-in, off by default — a drag-selection is copied on mouse-up. Off by default because a webview cannot reach the X11 primary selection, so this replaces the clipboard rather than a separate buffer.
```

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: move copy on selection to shipped"
```

---

## Post-implementation

- The block-selection gate is now two-dimensional. If a report arrives that block selection stopped triggering, the likely cause is a user making a small horizontal drag that now exceeds `DRAG_THRESHOLD_PX`; the fix is tuning that constant, not reverting to a single axis.
- Double-click and triple-click deliberately do not copy. If this is missed in daily use, adding it means a click-count check in the mouse-up handler — `e.detail >= 2` — inside the non-drag branch, and it should be weighed against the accidental-clipboard-overwrite risk that kept it out of this version.
