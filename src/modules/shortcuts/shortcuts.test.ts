import { describe, expect, it } from "vitest";
import {
  getBindingTokens,
  type KeyBinding,
  matchBinding,
  SHORTCUTS,
  type ShortcutId,
} from "./shortcuts";

function event(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...over,
  } as KeyboardEvent;
}

describe("getBindingTokens", () => {
  it("returns nothing for an undefined binding", () => {
    expect(getBindingTokens(undefined)).toEqual([]);
  });

  it("lists modifiers in order, then the key", () => {
    const binding: KeyBinding = { key: "k", ctrl: true, shift: true };
    expect(getBindingTokens(binding)).toEqual(["Ctrl", "Shift", "K"]);
  });

  it("labels space and arrow keys", () => {
    expect(getBindingTokens({ key: " ", meta: true })).toEqual([
      "Win",
      "Space",
    ]);
    expect(getBindingTokens({ key: "ArrowUp", alt: true })).toEqual([
      "Alt",
      "↑",
    ]);
  });

  it("uppercases a single-character key", () => {
    expect(getBindingTokens({ key: "c" })).toEqual(["C"]);
  });
});

describe("matchBinding", () => {
  it("matches when key and all modifiers agree", () => {
    expect(
      matchBinding(event({ key: "c", ctrlKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(true);
  });

  it("matches the key case-insensitively", () => {
    expect(
      matchBinding(event({ key: "C", ctrlKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(true);
  });

  it("fails when a required modifier is missing", () => {
    expect(matchBinding(event({ key: "c" }), { key: "c", ctrl: true })).toBe(
      false,
    );
  });

  it("fails when an extra modifier is pressed", () => {
    expect(
      matchBinding(event({ key: "c", ctrlKey: true, shiftKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(false);
  });

  it("falls back to the physical code for alt combinations", () => {
    // Alt often rewrites e.key (here to "ç"); the binding still matches via e.code.
    expect(
      matchBinding(event({ key: "ç", code: "KeyC", altKey: true }), {
        key: "c",
        alt: true,
      }),
    ).toBe(true);
    expect(
      matchBinding(event({ key: "ç", code: "KeyD", altKey: true }), {
        key: "c",
        alt: true,
      }),
    ).toBe(false);
  });

  it("only accepts digit keys for the jump-to-tab shortcut", () => {
    expect(
      matchBinding(event({ key: "3" }), { key: "1" }, "tab.selectByIndex"),
    ).toBe(true);
    expect(
      matchBinding(event({ key: "x" }), { key: "1" }, "tab.selectByIndex"),
    ).toBe(false);
  });
});

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
