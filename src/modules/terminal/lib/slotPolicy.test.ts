import { describe, expect, it } from "vitest";
import { pickSlot, type SlotView } from "./slotPolicy";

const CAPS = { soft: 5, hard: 8 };

function slot(over: Partial<SlotView> = {}): SlotView {
  return {
    bound: true,
    retained: false,
    retainedForRequester: false,
    visible: false,
    busy: false,
    altScreen: false,
    focused: false,
    lastUsedAt: 1,
    ...over,
  };
}

const busy = (lastUsedAt = 1) => slot({ busy: true, lastUsedAt });
const idle = (lastUsedAt = 1) => slot({ lastUsedAt });
const visible = () => slot({ visible: true, focused: true });

describe("pickSlot", () => {
  it("rebinds the requester's own retained buffer before anything else", () => {
    const slots = [
      slot({ bound: false }),
      slot({ bound: false, retained: true, retainedForRequester: true }),
    ];
    expect(pickSlot(slots, CAPS)).toEqual({ kind: "reuse", index: 1 });
  });

  it("grows freely below the soft cap without touching any buffer", () => {
    const slots = [idle(), idle(), slot({ bound: false, retained: true })];
    expect(pickSlot(slots, CAPS)).toEqual({ kind: "create" });
  });

  it("serializes an idle retained buffer before stealing an idle bound one", () => {
    const slots = [
      idle(1),
      visible(),
      busy(),
      slot({ bound: false, retained: true, lastUsedAt: 50 }),
      slot({ bound: false, retained: true, lastUsedAt: 40 }),
    ];
    expect(pickSlot(slots, CAPS)).toEqual({ kind: "reuse", index: 4 });
  });

  it("steals an idle hidden leaf rather than a busy one at the soft cap", () => {
    const slots = [busy(1), busy(2), visible(), idle(99), busy(3)];
    expect(pickSlot(slots, CAPS)).toEqual({ kind: "steal", index: 3 });
  });

  it("never steals a busy, alt-screen or visible leaf while below the hard cap", () => {
    const slots = [
      busy(1),
      slot({ altScreen: true, lastUsedAt: 0 }),
      visible(),
      busy(2),
      busy(3),
      slot({ bound: false, retained: true, busy: true, lastUsedAt: 0 }),
      busy(4),
    ];
    expect(slots.length).toBeLessThan(CAPS.hard);
    expect(pickSlot(slots, CAPS)).toEqual({ kind: "create" });
  });

  it("does not serialize a retained buffer whose leaf went busy", () => {
    const slots = [
      busy(),
      busy(),
      visible(),
      busy(),
      slot({ bound: false, retained: true, busy: true, lastUsedAt: 0 }),
    ];
    expect(pickSlot(slots, CAPS)).toEqual({ kind: "create" });
  });

  it("never grows past the hard cap and then gives up the least-bad grid", () => {
    const slots = [
      visible(),
      busy(5),
      busy(2),
      slot({ busy: true, altScreen: true, lastUsedAt: 0 }),
      busy(7),
      busy(3),
      busy(6),
      busy(4),
    ];
    expect(slots.length).toBe(CAPS.hard);
    const pick = pickSlot(slots, CAPS);
    expect(pick.kind).not.toBe("create");
    expect(pick).toEqual({ kind: "steal", index: 2 });
  });

  it("an idle leaf is taken even when the pool has already grown past the soft cap", () => {
    const slots = [busy(), busy(), visible(), busy(), busy(), busy(), idle(9)];
    expect(pickSlot(slots, CAPS)).toEqual({ kind: "steal", index: 6 });
  });
});
