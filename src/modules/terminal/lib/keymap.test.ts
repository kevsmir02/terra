import { describe, expect, it } from "vitest";

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

describe("terminalWordNavigationSequence", () => {
  it("maps Option+Left to readline word-left", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ altKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
      ),
    ).toBe("\x1bb");
  });

  it("maps Option+Right to readline word-right", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ altKey: true, key: "ArrowRight", code: "ArrowRight" }),
      ),
    ).toBe("\x1bf");
  });

  it("does not remap plain arrows", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ key: "ArrowLeft", code: "ArrowLeft" }),
      ),
    ).toBeNull();
  });
});

describe("terminalLineNavigationSequence", () => {
  it("maps Cmd+Left to readline line-start on macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: true },
      ),
    ).toBe("\x01");
  });

  it("maps Cmd+Right to readline line-end on macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowRight", code: "ArrowRight" }),
        { isMac: true },
      ),
    ).toBe("\x05");
  });

  it("does not remap Cmd+Arrow off macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: false },
      ),
    ).toBeNull();
  });

  it("does not remap Cmd+Option+Arrow (selection-style combos pass through)", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, altKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: true },
      ),
    ).toBeNull();
  });
});

describe("terminalDeleteSequence", () => {
  it("maps Cmd+Backspace to kill-to-line-start on macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBe("\x15");
  });

  it("maps Option+Backspace to kill-word-backward on macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ altKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBe("\x17");
  });

  it("maps Ctrl+Backspace to kill-word-backward off macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ ctrlKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: false },
      ),
    ).toBe("\x17");
  });

  it("does not remap Ctrl+Backspace on macOS (reserved for native readline binding)", () => {
    expect(
      terminalDeleteSequence(
        evt({ ctrlKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBeNull();
  });

  it("does not remap Cmd+Backspace off macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: false },
      ),
    ).toBeNull();
  });

  it("does not remap plain Backspace", () => {
    expect(
      terminalDeleteSequence(
        evt({ key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBeNull();
  });
});

describe("terminalReadlineSequence", () => {
  const remaps = [
    [
      "line navigation",
      evt({ metaKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
      "\x01",
    ],
    [
      "word navigation",
      evt({ altKey: true, key: "ArrowRight", code: "ArrowRight" }),
      "\x1bf",
    ],
    [
      "deletion",
      evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
      "\x15",
    ],
  ] as const;

  it.each(remaps)(
    "applies %s on the normal screen",
    (_name, event, sequence) => {
      expect(
        terminalReadlineSequence(event, {
          isMac: true,
          isAlternateScreen: false,
        }),
      ).toBe(sequence);
    },
  );

  it.each(remaps)("suppresses %s on the alternate screen", (_name, event) => {
    expect(
      terminalReadlineSequence(event, {
        isMac: true,
        isAlternateScreen: true,
      }),
    ).toBeNull();
  });
});

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

