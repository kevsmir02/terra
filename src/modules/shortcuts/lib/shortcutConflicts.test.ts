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
