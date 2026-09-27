/** What the pool knows about one slot when choosing where a leaf binds. */
export type SlotView = {
  /** Bound to a leaf right now (visible or parked). */
  bound: boolean;
  /** Holds the intact buffer of a released leaf. */
  retained: boolean;
  /** Retained for the leaf that is asking. */
  retainedForRequester: boolean;
  visible: boolean;
  /** The leaf owning the buffer has a foreground job or an agent running. */
  busy: boolean;
  altScreen: boolean;
  focused: boolean;
  lastUsedAt: number;
};

export type SlotCaps = { soft: number; hard: number };

export type SlotPick =
  | { kind: "reuse"; index: number }
  | { kind: "create" }
  | { kind: "steal"; index: number };

/**
 * A slot whose buffer must not be serialized: its leaf is on screen, running
 * a command, or inside a TUI whose incremental repaints cannot be replayed.
 */
export function isProtected(s: SlotView): boolean {
  return s.visible || s.busy || s.altScreen;
}

export function evictionScore(s: SlotView): number {
  return (
    (s.visible ? 1000 : 0) +
    (s.altScreen ? 100 : 0) +
    (s.busy ? 80 : 0) +
    (s.focused ? 10 : 0) +
    s.lastUsedAt / 1e12
  );
}

function lowest(
  slots: readonly SlotView[],
  keep: (s: SlotView) => boolean,
  rank: (s: SlotView) => number,
): number | null {
  let best: number | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (let i = 0; i < slots.length; i++) {
    if (!keep(slots[i])) continue;
    const r = rank(slots[i]);
    if (r < bestRank) {
      bestRank = r;
      best = i;
    }
  }
  return best;
}

/**
 * Where a leaf that needs a renderer binds. Up to the soft cap the pool grows
 * freely; past it an idle buffer is serialized to make room. A protected
 * buffer is never given up while the pool can still grow toward the hard cap,
 * and only once the hard cap is reached does the least-bad slot lose its grid.
 */
export function pickSlot(slots: readonly SlotView[], caps: SlotCaps): SlotPick {
  const own = slots.findIndex((s) => !s.bound && s.retainedForRequester);
  if (own >= 0) return { kind: "reuse", index: own };

  const clean = slots.findIndex((s) => !s.bound && !s.retained);
  if (clean >= 0) return { kind: "reuse", index: clean };

  if (slots.length < caps.soft) return { kind: "create" };

  const idleRetained = lowest(
    slots,
    (s) => !s.bound && !isProtected(s),
    (s) => s.lastUsedAt,
  );
  if (idleRetained !== null) return { kind: "reuse", index: idleRetained };

  const idleBound = lowest(
    slots,
    (s) => s.bound && !isProtected(s),
    evictionScore,
  );
  if (idleBound !== null) return { kind: "steal", index: idleBound };

  if (slots.length < caps.hard) return { kind: "create" };

  const leastBad = lowest(slots, () => true, evictionScore);
  if (leastBad === null) return { kind: "create" };
  return slots[leastBad].bound
    ? { kind: "steal", index: leastBad }
    : { kind: "reuse", index: leastBad };
}
