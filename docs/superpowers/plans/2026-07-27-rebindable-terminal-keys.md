# Rebindable Terminal Keys & Shortcut Conflict Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make terminal copy, paste, and Shift+Enter user-rebindable through the existing shortcut system, and surface chord clashes in the shortcut editor while recording.

**Architecture:** The three terminal chords get real entries in the `SHORTCUTS` table — so they gain the Settings row, cross-window persistence, and conflict detection for free — but dispatch stays inside `rendererPool`'s per-slot xterm key handler, which already owns the IME guard and the `slot` reference the clipboard operations need. The handler reads the live bindings straight off the preferences store when a key arrives, the way `rendererPool` already reads four other preferences, so a rebind needs no subscription and lands on the next keystroke. Conflict detection is a pure resolver consumed by a two-step recorder that previews a captured chord before committing it.

**Tech Stack:** TypeScript, React 19, zustand (preferences), xterm.js, Tauri 2, vitest (node environment — no jsdom, no React Testing Library), biome, knip.

**Design spec:** `docs/superpowers/specs/2026-07-27-rebindable-terminal-keys-design.md`

## Global Constraints

- **Tests run in the bare vitest node environment.** There is no jsdom and no React Testing Library. Component behavior (`ShortcutsSection`, `Recorder`) is verified manually, never with an automated test. Do not add a DOM test runner.
- **`IS_MAC` resolves to `false` under vitest**, because `@tauri-apps/plugin-os`'s `platform()` throws and `src/lib/platform.ts` falls back to `""`. Tests assert the non-macOS table unless they explicitly `vi.mock("@/lib/platform", …)`. This is already documented at `src/modules/shortcuts/shortcuts.test.ts:5`.
- **Never add AI attribution to commit messages.** No `Co-Authored-By: Claude …`, no "Generated with Claude Code". This is a standing project convention.
- **Commit messages use conventional-commit prefixes**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.
- **Every exported symbol must have a consumer** or `pnpm knip` fails CI. Only re-export a helper from `src/modules/shortcuts/index.ts` when something actually imports it from `@/modules/shortcuts`.
- **Terra ships for macOS and Linux but the code stays cross-platform** — Windows still builds in CI. Never gate behavior on platform beyond what the spec specifies.
- Package manager is **pnpm**. Test: `pnpm test`. Types: `pnpm check-types`. Lint: `pnpm lint`.

---

### Task 1: Register the three terminal shortcuts

Adds the table entries and widens `matchBinding` so a non-`KeyboardEvent` shape can be matched against a binding. After this task the three rows appear in Settings and persist, but the terminal still uses its hardcoded chords — Task 4 wires them together.

**Files:**
- Modify: `src/modules/shortcuts/shortcuts.ts` (`ShortcutId` union at 7-47; `SHORTCUTS` array; `matchBinding` at 381)
- Test: `src/modules/shortcuts/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ShortcutId` gains `"terminal.copy" | "terminal.paste" | "terminal.newline"`
  - `export type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">`
  - `matchBinding(e: KeyEventLike, binding: KeyBinding, id?: ShortcutId): boolean` (first parameter widened from `KeyboardEvent`)

- [x] **Step 1: Write the failing test**

Append to `src/modules/shortcuts/shortcuts.test.ts`. Note the file already defines an `event()` helper and imports `getBindingTokens`, `matchBinding`, and `type KeyBinding` — extend the import to add `SHORTCUTS` and `type ShortcutId`:

```ts
import {
  getBindingTokens,
  type KeyBinding,
  matchBinding,
  SHORTCUTS,
  type ShortcutId,
} from "./shortcuts";

function byId(id: ShortcutId) {
  const s = SHORTCUTS.find((x) => x.id === id);
  if (!s) throw new Error(`no shortcut registered for ${id}`);
  return s;
}

describe("terminal key shortcuts", () => {
  it("defaults copy and paste to Ctrl+Shift+C / Ctrl+Shift+V off macOS", () => {
    expect(byId("terminal.copy").defaultBindings).toEqual([
      { ctrl: true, shift: true, key: "c" },
    ]);
    expect(byId("terminal.paste").defaultBindings).toEqual([
      { ctrl: true, shift: true, key: "v" },
    ]);
  });

  it("defaults newline to Shift+Enter on every platform", () => {
    expect(byId("terminal.newline").defaultBindings).toEqual([
      { shift: true, key: "Enter" },
    ]);
  });

  it("groups all three under Terminal", () => {
    for (const id of [
      "terminal.copy",
      "terminal.paste",
      "terminal.newline",
    ] as const) {
      expect(byId(id).group).toBe("Terminal");
    }
  });

  it("matches the recorder's raw e.key casing against the table", () => {
    // The recorder stores e.key verbatim, so Ctrl+Shift+C is saved as "C".
    expect(
      matchBinding(
        event({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }),
        byId("terminal.copy").defaultBindings[0],
      ),
    ).toBe(true);
  });

  it("does not match Ctrl+C when the binding requires Shift", () => {
    expect(
      matchBinding(
        event({ key: "c", code: "KeyC", ctrlKey: true }),
        byId("terminal.copy").defaultBindings[0],
      ),
    ).toBe(false);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/modules/shortcuts/shortcuts.test.ts`
Expected: FAIL — `no shortcut registered for terminal.copy`. TypeScript will also reject `"terminal.copy"` as a `ShortcutId`.

- [x] **Step 3: Add the three entries to the union and the table**

In `src/modules/shortcuts/shortcuts.ts`, add to the `ShortcutId` union next to the other terminal ids:

```ts
  | "terminal.clear"
  | "terminal.toggleInput"
  | "terminal.copy"
  | "terminal.paste"
  | "terminal.newline"
```

Insert the entries into `SHORTCUTS` immediately after the `terminal.toggleInput` entry, keeping the Terminal group contiguous:

```ts
  {
    id: "terminal.copy",
    label: "Copy selection",
    group: "Terminal",
    // macOS routes ⌘C through the webview's own clipboard handling, which
    // already works; leave it unbound there rather than replacing it. The row
    // still shows in Settings so a mac user can bind something if they want.
    defaultBindings: IS_MAC ? [] : [{ ctrl: true, shift: true, key: "c" }],
  },
  {
    id: "terminal.paste",
    label: "Paste into terminal",
    group: "Terminal",
    defaultBindings: IS_MAC ? [] : [{ ctrl: true, shift: true, key: "v" }],
  },
  {
    id: "terminal.newline",
    label: "Insert newline without submitting",
    group: "Terminal",
    // No allowRepeat: the pool handler never consults it. Held Shift+Enter
    // still repeats because useGlobalShortcuts lets every keydown through to
    // xterm for a shortcut it has no handler for.
    defaultBindings: [{ shift: true, key: "Enter" }],
  },
```

`IS_MAC` is already imported at the top of the file.

- [x] **Step 4: Widen `matchBinding` to accept a structural key event**

Still in `src/modules/shortcuts/shortcuts.ts`, directly above `matchBinding`:

```ts
/** The subset of KeyboardEvent a chord comparison needs. Lets non-DOM callers
 * (the terminal keymap) match without fabricating a whole KeyboardEvent. */
export type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
>;
```

Change the signature only — the body is unchanged:

```ts
export function matchBinding(
  e: KeyEventLike,
  binding: KeyBinding,
  id?: ShortcutId
): boolean {
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/modules/shortcuts/shortcuts.test.ts`
Expected: PASS, all cases.

- [x] **Step 6: Verify nothing else broke**

Run: `pnpm check-types && pnpm test`
Expected: clean. `KeyboardEvent` is assignable to `KeyEventLike`, so `useGlobalShortcuts` and every existing caller compile unchanged.

- [x] **Step 7: Commit**

```bash
git add src/modules/shortcuts/shortcuts.ts src/modules/shortcuts/shortcuts.test.ts
git commit -m "feat(shortcuts): register terminal copy, paste, and newline chords"
```

---

### Task 2: Conflict resolver

A pure module answering "which other actions already claim this chord". Used by the recorder UI in Task 5 and by the binding resolver in Task 3.

**Files:**
- Create: `src/modules/shortcuts/lib/shortcutConflicts.ts`
- Create: `src/modules/shortcuts/lib/shortcutConflicts.test.ts`
- Create: `src/modules/shortcuts/lib/shortcutConflicts.mac.test.ts`
- Modify: `src/modules/shortcuts/index.ts`

**Interfaces:**
- Consumes: `SHORTCUTS`, `KeyBinding`, `ShortcutId` from Task 1's `shortcuts.ts`.
- Produces:
  - `sameBinding(a: KeyBinding, b: KeyBinding): boolean`
  - `type UserShortcuts = Partial<Record<ShortcutId, KeyBinding[]>>`
  - `activeBindings(id: ShortcutId, user: UserShortcuts): KeyBinding[]`
  - `conflictingShortcuts(binding: KeyBinding, self: ShortcutId, user: UserShortcuts): ShortcutId[]`
  - `shortcutLabels(ids: ShortcutId[]): string[]`

  `activeBindings`, `conflictingShortcuts`, and `shortcutLabels` are re-exported from `@/modules/shortcuts`. `sameBinding` is not — nothing outside this module and its test uses it.

- [x] **Step 1: Write the failing test**

Create `src/modules/shortcuts/lib/shortcutConflicts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "../shortcuts";
import {
  activeBindings,
  conflictingShortcuts,
  sameBinding,
  shortcutLabels,
} from "./shortcutConflicts";

// IS_MAC is false under vitest, so these exercise the non-mac default table.

describe("sameBinding", () => {
  it("compares the key case-insensitively", () => {
    // The recorder saves e.key verbatim ("C"); the table is authored "c".
    expect(
      sameBinding(
        { key: "C", ctrl: true, shift: true },
        { key: "c", ctrl: true, shift: true },
      ),
    ).toBe(true);
  });

  it("treats an absent modifier as false", () => {
    expect(
      sameBinding(
        { key: "c", ctrl: true },
        { key: "c", ctrl: true, shift: false, alt: false, meta: false },
      ),
    ).toBe(true);
  });

  it("rejects a differing modifier", () => {
    expect(
      sameBinding({ key: "c", ctrl: true }, { key: "c", ctrl: true, shift: true }),
    ).toBe(false);
  });
});

describe("activeBindings", () => {
  it("falls back to the factory default when the user has no entry", () => {
    expect(activeBindings("tab.new", {})).toEqual([{ ctrl: true, key: "t" }]);
  });

  it("preserves a deliberately cleared row as unassigned", () => {
    // An empty array means "unassigned" and must NOT fall back to the default.
    expect(activeBindings("tab.new", { "tab.new": [] })).toEqual([]);
  });
});

describe("conflictingShortcuts", () => {
  it("finds an action holding the chord by default", () => {
    expect(
      conflictingShortcuts({ ctrl: true, key: "t" }, "terminal.copy", {}),
    ).toContain("tab.new");
  });

  it("never reports the shortcut against itself", () => {
    expect(
      conflictingShortcuts({ ctrl: true, key: "t" }, "tab.new", {}),
    ).not.toContain("tab.new");
  });

  it("frees the chord an override replaced", () => {
    expect(
      conflictingShortcuts({ ctrl: true, key: "t" }, "terminal.copy", {
        "tab.new": [{ ctrl: true, key: "j" }],
      }),
    ).not.toContain("tab.new");
  });

  it("claims the chord an override moved to", () => {
    expect(
      conflictingShortcuts({ ctrl: true, key: "j" }, "terminal.copy", {
        "tab.new": [{ ctrl: true, key: "j" }],
      }),
    ).toContain("tab.new");
  });

  it("matches a non-first binding", () => {
    // sidebar.toggle owns both Ctrl+B and Ctrl+Shift+B.
    expect(
      conflictingShortcuts(
        { ctrl: true, shift: true, key: "b" },
        "terminal.copy",
        {},
      ),
    ).toContain("sidebar.toggle");
  });

  it("reports nothing for a cleared row", () => {
    expect(
      conflictingShortcuts({ ctrl: true, key: "t" }, "terminal.copy", {
        "tab.new": [],
      }),
    ).not.toContain("tab.new");
  });

  it("reports the eight extra chords tab.selectByIndex silently claims", () => {
    // Authored as Ctrl+1 but matchBinding swallows Ctrl+1..9, and the row is
    // hidden from the Settings list, so nothing else could reveal this.
    expect(
      conflictingShortcuts({ ctrl: true, key: "5" }, "terminal.copy", {}),
    ).toContain("tab.selectByIndex");
  });

  it("does not extend tab.selectByIndex to Ctrl+0", () => {
    expect(
      conflictingShortcuts({ ctrl: true, key: "0" }, "terminal.copy", {}),
    ).not.toContain("tab.selectByIndex");
  });

  it("ships no conflicting defaults", () => {
    for (const s of SHORTCUTS) {
      for (const b of s.defaultBindings) {
        expect(conflictingShortcuts(b, s.id, {})).toEqual([]);
      }
    }
  });
});

describe("shortcutLabels", () => {
  it("maps ids to their human labels", () => {
    expect(shortcutLabels(["tab.new"])).toEqual(["New tab"]);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/modules/shortcuts/lib/shortcutConflicts.test.ts`
Expected: FAIL — cannot resolve `./shortcutConflicts`.

- [x] **Step 3: Write the resolver**

Create `src/modules/shortcuts/lib/shortcutConflicts.ts`:

```ts
import { type KeyBinding, SHORTCUTS, type ShortcutId } from "../shortcuts";

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

export type UserShortcuts = Partial<Record<ShortcutId, KeyBinding[]>>;

/** Chord equality. The recorder stores `e.key` verbatim ("C", "Enter") while
 * the table is authored lowercase, and an absent modifier means false — so a
 * plain deep-equal would miss the most common clash. */
export function sameBinding(a: KeyBinding, b: KeyBinding): boolean {
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt &&
    !!a.meta === !!b.meta
  );
}

/** A shortcut's live bindings. A user entry wins even when it is empty: an
 * empty array is a deliberately cleared row, not a missing one, so `??` is
 * required here and a truthiness check would be wrong. */
export function activeBindings(
  id: ShortcutId,
  user: UserShortcuts,
): KeyBinding[] {
  return user[id] ?? BY_ID.get(id)?.defaultBindings ?? [];
}

/** `tab.selectByIndex` is authored as Mod+1, but matchBinding special-cases it
 * to swallow Mod+1 through Mod+9. It therefore claims eight chords that no row
 * displays — and the row is filtered out of the Settings list entirely. */
function claimsBinding(
  id: ShortcutId,
  binding: KeyBinding,
  user: UserShortcuts,
): boolean {
  const bindings = activeBindings(id, user);
  if (id === "tab.selectByIndex") {
    if (!/^[1-9]$/.test(binding.key)) return false;
    return bindings.some(
      (b) =>
        !!b.ctrl === !!binding.ctrl &&
        !!b.shift === !!binding.shift &&
        !!b.alt === !!binding.alt &&
        !!b.meta === !!binding.meta,
    );
  }
  return bindings.some((b) => sameBinding(b, binding));
}

/** Ids other than `self` whose live bindings already claim this chord.
 *
 * Scope gating (App.tsx's isDisabled) is deliberately not consulted:
 * useGlobalShortcuts is first-match-wins and `return`s rather than `continue`s
 * on a disabled or unhandled match, so a duplicate shadows even when the two
 * actions live on different surfaces. Every duplicate is a real conflict. */
export function conflictingShortcuts(
  binding: KeyBinding,
  self: ShortcutId,
  user: UserShortcuts,
): ShortcutId[] {
  return SHORTCUTS.filter(
    (s) => s.id !== self && claimsBinding(s.id, binding, user),
  ).map((s) => s.id);
}

export function shortcutLabels(ids: ShortcutId[]): string[] {
  return ids.map((id) => BY_ID.get(id)?.label ?? id);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/modules/shortcuts/lib/shortcutConflicts.test.ts`
Expected: PASS, all cases — including `ships no conflicting defaults`.

If that last case fails, it has found a real pre-existing collision in the default table. Do not weaken the test: report the colliding pair and stop.

- [x] **Step 5: Add the macOS variant of the guard test**

The table above is only the non-mac one, because `IS_MAC` is false under vitest. This change makes the defaults platform-conditional for the first time in a way that matters, so the mac table needs the same guard. `vi.mock` is hoisted and applies to a whole file, so this must be a separate file.

Create `src/modules/shortcuts/lib/shortcutConflicts.mac.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// shortcuts.ts reads IS_MAC and MOD_PROP at module scope, so the macOS table
// only exists under a mocked platform module plus a fresh import. Same pattern
// as src/modules/terminal/lib/quoteShellPath.test.ts.
vi.mock("@/lib/platform", () => ({ IS_MAC: true, MOD_PROP: "meta" as const }));

async function load() {
  vi.resetModules();
  const [shortcuts, conflicts] = await Promise.all([
    import("../shortcuts"),
    import("./shortcutConflicts"),
  ]);
  return { ...shortcuts, ...conflicts };
}

describe("macOS default table", () => {
  it("ships no conflicting defaults", async () => {
    const { SHORTCUTS, conflictingShortcuts } = await load();
    for (const s of SHORTCUTS) {
      for (const b of s.defaultBindings) {
        expect(conflictingShortcuts(b, s.id, {})).toEqual([]);
      }
    }
  });

  it("leaves terminal copy and paste unassigned so ⌘C/⌘V stay native", async () => {
    const { SHORTCUTS } = await load();
    expect(
      SHORTCUTS.find((s) => s.id === "terminal.copy")?.defaultBindings,
    ).toEqual([]);
    expect(
      SHORTCUTS.find((s) => s.id === "terminal.paste")?.defaultBindings,
    ).toEqual([]);
  });

  it("still binds newline to Shift+Enter", async () => {
    const { SHORTCUTS } = await load();
    expect(
      SHORTCUTS.find((s) => s.id === "terminal.newline")?.defaultBindings,
    ).toEqual([{ shift: true, key: "Enter" }]);
  });
});
```

- [x] **Step 6: Run the macOS variant**

Run: `pnpm test src/modules/shortcuts/lib/shortcutConflicts.mac.test.ts`
Expected: PASS. `terminal.clear` holds ⌘K only on this table, and `MOD_PROP` becomes `meta`, so this is a genuinely different set of chords from the one checked in Step 4.

- [x] **Step 7: Re-export from the module index**

In `src/modules/shortcuts/index.ts`, add below the existing `shortcutScope` export:

```ts
export {
  activeBindings,
  conflictingShortcuts,
  shortcutLabels,
  type UserShortcuts,
} from "./lib/shortcutConflicts";
```

`sameBinding` is intentionally not re-exported — only this module and its test use it, and an unconsumed re-export fails `pnpm knip`.

- [x] **Step 8: Verify**

Run: `pnpm check-types && pnpm test`
Expected: clean.

- [x] **Step 9: Commit**

```bash
git add src/modules/shortcuts/lib/shortcutConflicts.ts src/modules/shortcuts/lib/shortcutConflicts.test.ts src/modules/shortcuts/lib/shortcutConflicts.mac.test.ts src/modules/shortcuts/index.ts
git commit -m "feat(shortcuts): add chord conflict resolver"
```

---

### Task 3: Terminal key matcher

The pure decision function the pool handler will call, plus the resolver turning stored preferences into the bindings it needs.

**Files:**
- Modify: `src/modules/terminal/lib/keymap.ts`
- Test: `src/modules/terminal/lib/keymap.test.ts`

**Interfaces:**
- Consumes: `matchBinding`, `KeyEventLike`, `KeyBinding`, `ShortcutId` from Task 1; `activeBindings`, `UserShortcuts` from Task 2.
- Produces:
  - `type TerminalKeyEvent = KeyEventLike` (now includes `shiftKey`)
  - `type TerminalKeyAction = "copy" | "paste" | "newline"`
  - `type TerminalKeyBindings = Record<TerminalKeyAction, KeyBinding[]>`
  - `terminalKeyAction(event: TerminalKeyEvent, bindings: TerminalKeyBindings): TerminalKeyAction | null`
  - `resolveTerminalKeyBindings(user: UserShortcuts): TerminalKeyBindings`

- [x] **Step 1: Write the failing test**

In `src/modules/terminal/lib/keymap.test.ts`, extend the import and add `shiftKey: false` to the `evt` factory:

```ts
import {
  resolveTerminalKeyBindings,
  terminalDeleteSequence,
  terminalKeyAction,
  type TerminalKeyBindings,
  type TerminalKeyEvent,
  terminalLineNavigationSequence,
  terminalReadlineSequence,
  terminalWordNavigationSequence,
} from "./keymap";

const evt = (partial: Partial<TerminalKeyEvent>): TerminalKeyEvent => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: "",
  code: "",
  ...partial,
});
```

Then append:

```ts
const BOUND: TerminalKeyBindings = {
  copy: [{ ctrl: true, shift: true, key: "c" }],
  paste: [{ ctrl: true, shift: true, key: "v" }],
  newline: [{ shift: true, key: "Enter" }],
};

describe("terminalKeyAction", () => {
  it("recognises the bound copy chord", () => {
    expect(
      terminalKeyAction(
        evt({ ctrlKey: true, shiftKey: true, key: "C", code: "KeyC" }),
        BOUND,
      ),
    ).toBe("copy");
  });

  it("recognises the bound paste chord", () => {
    expect(
      terminalKeyAction(
        evt({ ctrlKey: true, shiftKey: true, key: "V", code: "KeyV" }),
        BOUND,
      ),
    ).toBe("paste");
  });

  it("recognises the bound newline chord", () => {
    expect(
      terminalKeyAction(
        evt({ shiftKey: true, key: "Enter", code: "Enter" }),
        BOUND,
      ),
    ).toBe("newline");
  });

  it("ignores an unbound key so it reaches the shell", () => {
    expect(terminalKeyAction(evt({ key: "a", code: "KeyA" }), BOUND)).toBeNull();
  });

  it("requires every modifier to match", () => {
    // Plain Ctrl+C must still reach the PTY as SIGINT.
    expect(
      terminalKeyAction(evt({ ctrlKey: true, key: "c", code: "KeyC" }), BOUND),
    ).toBeNull();
  });

  it("matches nothing for an unassigned action", () => {
    expect(
      terminalKeyAction(
        evt({ ctrlKey: true, shiftKey: true, key: "C", code: "KeyC" }),
        { ...BOUND, copy: [] },
      ),
    ).toBeNull();
  });

  it("matches nothing when every action is unassigned", () => {
    // The macOS shape: copy and paste unbound so ⌘C/⌘V stay native.
    const none: TerminalKeyBindings = { copy: [], paste: [], newline: [] };
    expect(
      terminalKeyAction(
        evt({ ctrlKey: true, shiftKey: true, key: "C", code: "KeyC" }),
        none,
      ),
    ).toBeNull();
  });
});

describe("resolveTerminalKeyBindings", () => {
  it("uses the factory defaults when nothing is customised", () => {
    expect(resolveTerminalKeyBindings({})).toEqual(BOUND);
  });

  it("applies a user override", () => {
    expect(
      resolveTerminalKeyBindings({
        "terminal.copy": [{ ctrl: true, alt: true, key: "c" }],
      }).copy,
    ).toEqual([{ ctrl: true, alt: true, key: "c" }]);
  });

  it("keeps a cleared action unassigned", () => {
    expect(resolveTerminalKeyBindings({ "terminal.paste": [] }).paste).toEqual(
      [],
    );
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/modules/terminal/lib/keymap.test.ts`
Expected: FAIL — `terminalKeyAction` is not exported.

- [x] **Step 3: Implement in `keymap.ts`**

Replace the `TerminalKeyEvent` definition at the top of `src/modules/terminal/lib/keymap.ts` and add the new exports. The existing sequence functions are unchanged.

```ts
import {
  activeBindings,
  type UserShortcuts,
} from "@/modules/shortcuts";
import {
  type KeyBinding,
  type KeyEventLike,
  matchBinding,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";

// Was a narrower Pick that omitted shiftKey; the rebindable chords need it.
export type TerminalKeyEvent = KeyEventLike;

export type PlatformOpts = { isMac: boolean };
```

Append to the end of the file:

```ts
export type TerminalKeyAction = "copy" | "paste" | "newline";

export type TerminalKeyBindings = Record<TerminalKeyAction, KeyBinding[]>;

const TERMINAL_SHORTCUT_IDS = {
  copy: "terminal.copy",
  paste: "terminal.paste",
  newline: "terminal.newline",
} as const satisfies Record<TerminalKeyAction, ShortcutId>;

/** Which rebindable terminal action this chord triggers, or null to let the
 * key fall through to the readline remaps and then to xterm. An unassigned
 * action matches nothing, which is what keeps ⌘C/⌘V native on macOS. */
export function terminalKeyAction(
  event: TerminalKeyEvent,
  bindings: TerminalKeyBindings,
): TerminalKeyAction | null {
  for (const action of ["newline", "copy", "paste"] as const) {
    if (bindings[action].some((b) => matchBinding(event, b))) return action;
  }
  return null;
}

export function resolveTerminalKeyBindings(
  user: UserShortcuts,
): TerminalKeyBindings {
  return {
    copy: activeBindings(TERMINAL_SHORTCUT_IDS.copy, user),
    paste: activeBindings(TERMINAL_SHORTCUT_IDS.paste, user),
    newline: activeBindings(TERMINAL_SHORTCUT_IDS.newline, user),
  };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/modules/terminal/lib/keymap.test.ts`
Expected: PASS — the new cases plus all pre-existing readline-sequence cases.

- [x] **Step 5: Verify**

Run: `pnpm check-types && pnpm test`
Expected: clean.

- [x] **Step 6: Commit**

```bash
git add src/modules/terminal/lib/keymap.ts src/modules/terminal/lib/keymap.test.ts
git commit -m "feat(terminal): match terminal chords against user bindings"
```

---

### Task 4: Wire the pool to user bindings

Replaces the hardcoded predicates with the matcher, reading the live bindings from the preferences store at the point of use. **This is the task that makes rebinding actually work.**

**Files:**
- Modify: `src/modules/terminal/lib/rendererPool.ts` (imports at 1-16; handler at 238-285; predicates at 1032-1058)

**Interfaces:**
- Consumes: `terminalKeyAction`, `resolveTerminalKeyBindings` from Task 3.
- Produces: nothing. No new exports, no module state, no subscription — the handler reads `usePreferencesStore.getState().shortcuts` when a key arrives, which `rendererPool.ts` already does at lines 170, 620, 757, and 979.

- [x] **Step 1: Extend the keymap import**

In `src/modules/terminal/lib/rendererPool.ts`:

```ts
import {
  resolveTerminalKeyBindings,
  terminalKeyAction,
  terminalReadlineSequence,
} from "./keymap";
```

`usePreferencesStore` is already imported at line 2.

- [x] **Step 2: Rewrite the key handler**

Replace the body of `term.attachCustomKeyEventHandler` at `rendererPool.ts:238` with the following. The IME comment block above `event.isComposing` is unchanged — keep it verbatim.

```ts
  term.attachCustomKeyEventHandler((event) => {
    // During IME composition the browser is assembling a multi-keystroke
    // character (Chinese pinyin → hanzi, Korean jamo → syllable, etc.).
    // Raw keydown events — including the Enter that commits a candidate —
    // must NOT be forwarded to the PTY; xterm will receive the final
    // composed string through its own compositionend handler instead.
    // keyCode 229 ("Process") is what Chromium reports for every key
    // pressed inside an active IME session when isComposing is not yet set.
    if (event.isComposing || event.keyCode === 229) return false;

    const leafId = slot.currentLeafId;
    if (leafId === null) return false;
    const bridge = adapter?.resolveLeaf(leafId);
    if (!bridge) return true;

    // User-configured chords are checked before the hardcoded readline remaps
    // so an explicit binding always beats an implicit default. The shipped
    // defaults do not overlap, so this only matters once someone rebinds.
    // Read at point of use: a rebind lands on the very next keystroke, with no
    // subscription to keep in sync. Before hydration `shortcuts` is {} and this
    // resolves to the factory defaults.
    const action = terminalKeyAction(
      event,
      resolveTerminalKeyBindings(usePreferencesStore.getState().shortcuts),
    );
    if (action === "newline") {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty("\x1b\r");
      return false;
    }
    if (action === "copy") {
      // Swallowed even with nothing selected. Falling through would hand the
      // chord to xterm, which can emit \x03 and SIGINT a running job — worse
      // than doing nothing.
      if (event.type === "keydown" && slot.term.hasSelection()) {
        const sel = slot.term.getSelection();
        if (sel) void writeTerminalClipboard(sel);
      }
      event.preventDefault();
      return false;
    }
    if (action === "paste") {
      if (event.type === "keydown") {
        const targetLeafId = slot.currentLeafId;
        void readTerminalClipboard().then((text) => {
          if (text && slot.currentLeafId === targetLeafId) slot.term.paste(text);
        });
      }
      event.preventDefault();
      return false;
    }

    const readlineSequence = terminalReadlineSequence(event, {
      isMac: IS_MAC,
      isAlternateScreen: isAltScreen(slot),
    });
    if (readlineSequence) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty(readlineSequence);
      return false;
    }
    return true;
  });
```

- [x] **Step 3: Delete the hardcoded predicates**

Remove `isTerminalCopy`, `isTerminalPaste`, and `isShiftEnter` — the three functions at `rendererPool.ts:1032-1058`. **Keep the `IS_MAC` constant above them** (lines 1028-1030); it is still used by the `terminalReadlineSequence` call.

- [x] **Step 4: Verify the build and the suite**

Run: `pnpm check-types && pnpm test && pnpm lint`
Expected: clean. Nothing should reference the deleted predicates.

- [x] **Step 5: Manual verification**

Run `pnpm tauri dev` and confirm each of these. There is no DOM test infrastructure, so this checklist is the only coverage for the wiring itself.

- Ctrl+Shift+C with a selection copies; Ctrl+Shift+V pastes. (Unchanged defaults.)
- Ctrl+Shift+C with **no** selection does nothing and does **not** interrupt a running command.
- Plain Ctrl+C still sends SIGINT.
- Shift+Enter inserts a newline without submitting, and repeats when held.
- Open Settings → Shortcuts → Terminal, rebind "Paste into terminal" to Ctrl+Alt+V, and confirm it works in the main window **without restarting**, and that Ctrl+Shift+V no longer pastes.
- Clear the "Copy selection" row and confirm Ctrl+Shift+C stops copying.
- Alt+←/→ still perform word navigation; Ctrl+Backspace still kills a word.
- With an IME active (e.g. Pinyin), the Enter that commits a candidate does not send a newline to the shell.
- On macOS if available: ⌘C and ⌘V still copy and paste with both rows unassigned.

- [x] **Step 6: Commit**

```bash
git add src/modules/terminal/lib/rendererPool.ts
git commit -m "feat(terminal): make copy, paste, and Shift+Enter rebindable"
```

---

### Task 5: Two-step recorder with conflict preview

The recorder currently commits on the first non-modifier keydown. It becomes: capture → preview the chord and any clash → apply.

**Files:**
- Modify: `src/settings/sections/ShortcutsSection.tsx` (`ShortcutRow` at 164-248; `Recorder` at 250-328)

**Interfaces:**
- Consumes: `conflictingShortcuts`, `shortcutLabels` from Task 2; `getBindingTokens`, `KeyBinding`, `ShortcutId` from `shortcuts.ts`.
- Produces: `Recorder` gains a required `selfId: ShortcutId` prop.

- [x] **Step 1: Extend the imports**

In `src/settings/sections/ShortcutsSection.tsx`:

```ts
import { conflictingShortcuts, shortcutLabels } from "@/modules/shortcuts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

`Kbd`, `KbdGroup`, `Button`, `getBindingTokens`, and `usePreferencesStore` are already imported.

- [x] **Step 2: Pass the shortcut id into the recorder**

In `ShortcutRow`'s JSX, change the recorder element:

```tsx
        {isRecording ? (
          <Recorder
            selfId={shortcut.id}
            onRecord={onRecord}
            onCancel={onStopRecording}
          />
        ) : (
```

- [x] **Step 3: Replace the `Recorder` component**

Replace the whole `Recorder` function (lines 250-328) with:

```tsx
function Recorder({
  selfId,
  onRecord,
  onCancel,
}: {
  selfId: ShortcutId;
  onRecord: (b: KeyBinding) => void;
  onCancel: () => void;
}) {
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const [pending, setPending] = useState<KeyBinding | null>(null);
  // The keydown listener is bound once, so it reads the captured chord through
  // a ref rather than a stale closure over state.
  const pendingRef = useRef<KeyBinding | null>(null);

  const capture = useCallback((b: KeyBinding | null) => {
    pendingRef.current = b;
    setPending(b);
  }, []);

  const conflicts = useMemo(
    () => (pending ? conflictingShortcuts(pending, selfId, userShortcuts) : []),
    [pending, selfId, userShortcuts],
  );

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Bare Enter applies the captured chord. Safe to claim because the
      // capture guard below rejects it as a binding, while Shift+Enter — the
      // default for terminal.newline — still records normally.
      const held = pendingRef.current;
      if (
        held &&
        e.key === "Enter" &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        onRecord(held);
        return;
      }

      if (e.key === "Escape") {
        onCancel();
        return;
      }

      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      // Require at least one primary modifier (Ctrl, Alt, Meta).
      // Reject Shift-only shortcuts that would insert a character — this is
      // what blocks Shift+2 ("@") and Shift+, ("<") on many layouts.
      const hasPrimaryModifier = e.ctrlKey || e.altKey || e.metaKey;
      const isCharacterKey = e.key.length === 1;
      if (!hasPrimaryModifier && (!e.shiftKey || isCharacterKey)) return;

      // Replaces any previously captured chord, so the user can re-try
      // without leaving the recorder.
      capture({
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      });
    };

    window.addEventListener("keydown", onDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onDown, { capture: true });
    };
  }, [onRecord, onCancel, capture]);

  if (!pending) {
    return (
      <div className="flex items-center gap-2 rounded bg-accent/50 px-2 py-1 text-[11px] ring-1 ring-accent">
        <span className="animate-pulse font-medium">Recording...</span>
        <span className="text-muted-foreground">(Esc to cancel)</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 rounded bg-accent/50 px-2 py-1.5 text-[11px] ring-1 ring-accent">
      <div className="flex items-center gap-2">
        <KbdGroup>
          {getBindingTokens(pending).map((t, i) => (
            <Kbd key={i}>{t}</Kbd>
          ))}
        </KbdGroup>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => onRecord(pending)}
        >
          Apply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {conflicts.length > 0 && (
        <span className="text-destructive">
          Already used by {shortcutLabels(conflicts).join(", ")}
        </span>
      )}
      <span className="text-muted-foreground">Enter to apply · Esc to cancel</span>
    </div>
  );
}
```

The old `_mods` state and the `keyup` listener that maintained it are removed — the captured-chord preview replaces what they were for.

- [x] **Step 4: Verify the build**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: clean.

- [x] **Step 5: Manual verification**

Run `pnpm tauri dev`, open Settings → Shortcuts:

- Click a row's chord. It reads "Recording..." until a chord is pressed.
- Press Ctrl+Alt+K. The chord renders as `Ctrl Alt K` with Apply/Cancel and no conflict line. Press Enter — it saves.
- Record again and press Ctrl+T on any row other than "New tab". The line **Already used by New tab** appears, and Apply is still enabled.
- Press a different chord while one is already captured — the preview replaces it without leaving the recorder.
- Press Esc while a chord is captured — nothing is saved.
- On the "Insert newline without submitting" row, press Shift+Enter — it must be **captured as a chord**, not treated as apply. Then press bare Enter to apply it.
- Record a chord that clashes with two actions and confirm both labels are listed, comma-separated.

- [x] **Step 6: Commit**

```bash
git add src/settings/sections/ShortcutsSection.tsx
git commit -m "feat(settings): preview a recorded chord and its conflicts before applying"
```

---

### Task 6: Persistent row warnings and roadmap update

Two-step recording only catches clashes created from now on. This surfaces duplicates that were already saved, then closes out the roadmap entries.

**Files:**
- Modify: `src/settings/sections/ShortcutsSection.tsx` (`ShortcutsSection` row rendering; `ShortcutRow`)
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: `conflictingShortcuts`, `shortcutLabels` from Task 2 (already imported by Task 5).
- Produces: `ShortcutRow` gains a required `userShortcuts: UserShortcuts` prop.

- [x] **Step 1: Pass the stored shortcuts into each row**

In `ShortcutsSection`'s `items.map(...)`, add the prop:

```tsx
                  <ShortcutRow
                    key={s.id}
                    shortcut={s}
                    isRecording={recordingId === s.id}
                    onStartRecording={() => setRecordingId(s.id)}
                    onStopRecording={() => setRecordingId(null)}
                    onRecord={(b) => onRecord(s.id, b)}
                    onClear={() => onClear(s.id)}
                    onReset={() => onResetShortcut(s.id)}
                    userBindings={userShortcuts[s.id]}
                    userShortcuts={userShortcuts}
                  />
```

- [x] **Step 2: Compute and render the warning**

In `ShortcutRow`, add `userShortcuts: UserShortcuts` to the props type, import the type alongside the helpers:

```ts
import {
  conflictingShortcuts,
  shortcutLabels,
  type UserShortcuts,
} from "@/modules/shortcuts";
```

Then, after the existing `hasBindings` line:

```tsx
  // Two-step recording only catches clashes made from now on; a duplicate
  // saved before this shipped would otherwise stay invisible.
  const conflicts = useMemo(
    () => [
      ...new Set(
        (bindings ?? []).flatMap((b) =>
          conflictingShortcuts(b, shortcut.id, userShortcuts),
        ),
      ),
    ],
    [bindings, shortcut.id, userShortcuts],
  );
```

And render it under the label:

```tsx
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium">{shortcut.label}</span>
        {conflicts.length > 0 && (
          <span className="text-[11px] text-destructive">
            Conflicts with {shortcutLabels(conflicts).join(", ")}
          </span>
        )}
      </div>
```

- [x] **Step 3: Verify the build**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: clean.

- [x] **Step 4: Manual verification**

Run `pnpm tauri dev`, open Settings → Shortcuts:

- With factory defaults, **no** row shows a conflict warning.
- Bind "Find in tab" to Ctrl+T, then leave and re-enter the section. Both "Find in tab" and "New tab" show `Conflicts with …` naming the other.
- Click "Reset All" and confirm every warning disappears.

- [x] **Step 5: Move both roadmap entries to Shipped**

In `ROADMAP.md`, delete these two lines from **Planned → Coming next**:

```markdown
- [ ] **Rebindable Terminal Keys**: Terminal copy, paste, and Shift+Enter are hardcoded in the xterm key handler and bypass the shortcut system that already covers the other 40 actions.
- [ ] **Shortcut Conflict Detection**: Binding a chord already claimed by another action silently shadows it; the shortcut editor should surface the clash while recording.
```

Add to **Shipped → Terminal & Spaces**, after the "Copy on Selection" entry:

```markdown
- [x] **Rebindable Terminal Keys**: Terminal copy, paste, and Shift+Enter moved out of the hardcoded xterm key handler into the shortcut system. Copy and paste ship unbound on macOS so ⌘C/⌘V stay on the webview's native path; an unassigned chord falls through to the shell.
```

Add to **Shipped → Themes & Customization**, after "Customizable UI keybindings":

```markdown
- [x] **Shortcut Conflict Detection**: Recording a chord previews it with the actions that already claim it before it is applied, and rows whose saved bindings clash stay flagged. Includes the eight chords `tab.selectByIndex` silently swallows.
```

- [x] **Step 6: Full gate**

Run: `pnpm check-types && pnpm test && pnpm lint && pnpm knip`
Expected: all clean. `knip` matters here — it fails on any export added in Tasks 2 and 3 that nothing consumes.

- [x] **Step 7: Commit**

```bash
git add src/settings/sections/ShortcutsSection.tsx ROADMAP.md
git commit -m "feat(settings): flag saved shortcut conflicts on their rows"
```

---

## Deviations from the spec

One, worth flagging to the reviewer:

- The spec's file table says `src/modules/shortcuts/index.ts` re-exports "the conflict helpers". This plan re-exports `activeBindings`, `conflictingShortcuts`, `shortcutLabels`, and `UserShortcuts`, but deliberately **not** `sameBinding` — only `shortcutConflicts.ts` and its own test use it, and `pnpm knip` fails on an unconsumed re-export.
