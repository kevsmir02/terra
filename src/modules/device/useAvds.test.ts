import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOOT_PHASE_LABEL, type BootPhase } from "./useAvds";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookSrc = readFileSync(path.join(here, "useAvds.ts"), "utf8");
const emptyStatesSrc = readFileSync(path.join(here, "emptyStates.tsx"), "utf8");
const dropdownSrc = readFileSync(path.join(here, "DeviceDropdown.tsx"), "utf8");

describe("BOOT_PHASE_LABEL", () => {
  it("labels every phase the backend can emit", () => {
    const phases: BootPhase[] = [
      "starting",
      "waiting-for-device",
      "booting",
      "ready",
      "failed",
    ];
    for (const phase of phases) {
      expect(BOOT_PHASE_LABEL[phase]).toBeTruthy();
    }
    expect(Object.keys(BOOT_PHASE_LABEL)).toHaveLength(phases.length);
  });
});

describe("AVD boot is event-driven", () => {
  it("subscribes to the backend boot event", () => {
    expect(hookSrc).toMatch(/device:avd-boot/);
    expect(hookSrc).toMatch(/getCurrentWebviewWindow\(\)\.listen/);
  });

  // Regression: launch used to fire `setTimeout(onRefresh, 3000)` and call it
  // done, but a cold boot takes 20-60s+, so the refresh always landed before
  // the device existed and the launch looked like it had failed.
  it("does not guess at boot duration with a fixed timer", () => {
    for (const src of [hookSrc, emptyStatesSrc, dropdownSrc]) {
      expect(src).not.toMatch(/setTimeout/);
      expect(src).not.toMatch(/setInterval/);
    }
  });

  it("unsubscribes the listener on unmount", () => {
    expect(hookSrc).toMatch(/unlisten\.then\(\(off\) => off\(\)\)/);
  });
});

describe("emulator lifecycle affordances", () => {
  it("offers stop only for emulators Terra launched", () => {
    // `managed` is the backend's flag for "this process started it"; gating the
    // Stop button on it keeps Terra from killing an Android Studio emulator.
    expect(emptyStatesSrc).toMatch(/avd\.managed && runningSerial/);
    expect(dropdownSrc).toMatch(/avd\.managed && runningSerial/);
  });

  it("attaches to an already-running AVD instead of relaunching it", () => {
    // Relaunching a booted AVD fails on its lock file.
    expect(dropdownSrc).toMatch(/readyDevice \? onPick\(readyDevice\)/);
  });
});
