import { beforeEach, describe, expect, it } from "vitest";
import {
  clampDockWidth,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  readDockCollapsed,
  readDockWidth,
} from "./useDeviceDock";

function stubStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  // Vitest runs in the node environment, so localStorage does not exist.
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
  // Make globalThis.window available for window.localStorage access in tests
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

describe("clampDockWidth", () => {
  beforeEach(() => stubStorage());

  it("keeps a width already inside the range", () => {
    expect(clampDockWidth(400)).toBe(400);
  });

  it("clamps to the documented bounds", () => {
    expect(clampDockWidth(10)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(5000)).toBe(DOCK_MAX_WIDTH);
  });

  it("rounds fractional widths from pixel drags", () => {
    expect(clampDockWidth(341.6)).toBe(342);
  });
});

describe("readDockWidth", () => {
  it("falls back to the default when nothing is stored", () => {
    stubStorage();
    expect(readDockWidth()).toBe(DOCK_DEFAULT_WIDTH);
  });

  it("falls back to the default when the stored value is garbage", () => {
    stubStorage({ "terax.deviceDock.width": "not-a-number" });
    expect(readDockWidth()).toBe(DOCK_DEFAULT_WIDTH);
  });

  it("clamps an out-of-range stored width", () => {
    stubStorage({ "terax.deviceDock.width": "9999" });
    expect(readDockWidth()).toBe(DOCK_MAX_WIDTH);
  });

  it("returns a valid stored width", () => {
    stubStorage({ "terax.deviceDock.width": "420" });
    expect(readDockWidth()).toBe(420);
  });
});

describe("readDockCollapsed", () => {
  it("is false by default", () => {
    stubStorage();
    expect(readDockCollapsed()).toBe(false);
  });

  it("is true only for the exact stored flag", () => {
    stubStorage({ "terax.deviceDock.collapsed": "1" });
    expect(readDockCollapsed()).toBe(true);
    stubStorage({ "terax.deviceDock.collapsed": "0" });
    expect(readDockCollapsed()).toBe(false);
  });
});
