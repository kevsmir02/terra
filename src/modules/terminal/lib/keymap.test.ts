import { describe, expect, it } from "vitest";

import {
  resolveTerminalKeyBindings,
  terminalDeleteSequence,
  terminalKeyAction,
  type TerminalKeyBindings,
  type TerminalKeyEvent,
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
  it("maps Alt+Left to readline word-left", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ altKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
      ),
    ).toBe("\x1bb");
  });

  it("maps Alt+Right to readline word-right", () => {
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

describe("terminalDeleteSequence", () => {
  it("maps Ctrl+Backspace to kill-word-backward", () => {
    expect(
      terminalDeleteSequence(
        evt({ ctrlKey: true, key: "Backspace", code: "Backspace" }),
      ),
    ).toBe("\x17");
  });

  it("leaves Meta+Backspace and Alt+Backspace to the shell", () => {
    expect(
      terminalDeleteSequence(
        evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
      ),
    ).toBeNull();
    expect(
      terminalDeleteSequence(
        evt({ altKey: true, key: "Backspace", code: "Backspace" }),
      ),
    ).toBeNull();
  });

  it("does not remap plain Backspace", () => {
    expect(
      terminalDeleteSequence(evt({ key: "Backspace", code: "Backspace" })),
    ).toBeNull();
  });
});

describe("terminalReadlineSequence", () => {
  const remaps = [
    [
      "word navigation",
      evt({ altKey: true, key: "ArrowRight", code: "ArrowRight" }),
      "\x1bf",
    ],
    [
      "deletion",
      evt({ ctrlKey: true, key: "Backspace", code: "Backspace" }),
      "\x17",
    ],
  ] as const;

  it.each(remaps)(
    "applies %s on the normal screen",
    (_name, event, sequence) => {
      expect(
        terminalReadlineSequence(event, { isAlternateScreen: false }),
      ).toBe(sequence);
    },
  );

  it.each(remaps)("suppresses %s on the alternate screen", (_name, event) => {
    expect(
      terminalReadlineSequence(event, { isAlternateScreen: true }),
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
