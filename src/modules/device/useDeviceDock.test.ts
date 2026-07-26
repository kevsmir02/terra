import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  clampDockWidth,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
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

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

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

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

describe("the dock is the only device surface", () => {
  // Two mount sites racing over one scrcpy session is the failure this
  // refactor could reintroduce, and it would not surface as a type error.
  // `--exclude` is load-bearing: these patterns are string literals in THIS
  // file, which lives under src/, so an unfiltered grep matches itself and the
  // assertion can never pass.
  it("mounts DevicePreviewPane in exactly one place", () => {
    const hits = execSync(
      "grep -rl '<DevicePreviewPane' src/ --exclude=useDeviceDock.test.ts || true",
      { cwd: repoRoot, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual(["src/modules/device/DeviceDock.tsx"]);
  });

  it("has no device-preview tab kind left in the codebase", () => {
    const hits = execSync(
      "grep -rn 'device-preview\\|DevicePreviewTab\\|newDevicePreviewTab' src/ --exclude=useDeviceDock.test.ts || true",
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();
    expect(hits).toBe("");
  });
});
