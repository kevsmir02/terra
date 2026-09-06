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

export function terminalWordNavigationSequence(event: TerminalKeyEvent): string | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowLeft" || event.code === "ArrowLeft") return "\x1bb";
  if (event.key === "ArrowRight" || event.code === "ArrowRight") return "\x1bf";
  return null;
}

/** Ctrl+Backspace kills the word backward (Ctrl+W) like every Linux terminal. */
export function terminalDeleteSequence(event: TerminalKeyEvent): string | null {
  if (event.key !== "Backspace" && event.code !== "Backspace") return null;
  if (event.ctrlKey && !event.altKey && !event.metaKey) return "\x17";
  return null;
}

export function terminalReadlineSequence(
  event: TerminalKeyEvent,
  opts: { isAlternateScreen: boolean },
): string | null {
  if (opts.isAlternateScreen) return null;
  return (
    terminalWordNavigationSequence(event) ?? terminalDeleteSequence(event)
  );
}

export type TerminalKeyAction = "copy" | "paste" | "newline";

export type TerminalKeyBindings = Record<TerminalKeyAction, KeyBinding[]>;

const TERMINAL_SHORTCUT_IDS = {
  copy: "terminal.copy",
  paste: "terminal.paste",
  newline: "terminal.newline",
} as const satisfies Record<TerminalKeyAction, ShortcutId>;

/** Which rebindable terminal action this chord triggers, or null to let the
 * key fall through to the readline remaps and then to xterm. An unassigned
 * action matches nothing. */
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
