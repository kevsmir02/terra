import { type KeyBinding, SHORTCUTS, type ShortcutId } from "../shortcuts";

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

export type UserShortcuts = Partial<Record<ShortcutId, KeyBinding[]>>;

/** Chord equality. The recorder stores `e.key` verbatim ("C", "Enter") while
 * the table is authored lowercase, and an absent modifier means false, so a
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
 * displays, and the row is filtered out of the Settings list entirely. */
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
