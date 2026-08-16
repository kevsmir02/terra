import {
  pollIntervalMs,
  shouldMountPill,
} from "@/modules/services/lib/pillGate";
import { describe, expect, it } from "vitest";

describe("shouldMountPill", () => {
  it("stays out of the way until services are enabled", () => {
    expect(shouldMountPill({ services: [] })).toBe(false);
    expect(shouldMountPill(undefined)).toBe(false);
  });

  it("mounts once any service is enabled", () => {
    expect(shouldMountPill({ services: ["mariadb"] })).toBe(true);
  });
});

describe("pollIntervalMs", () => {
  it("polls a focused window even when nothing is known to be running", () => {
    // The regression: hasRunning can only become true after a poll, so gating
    // the first poll on it left the pill dead for the whole session.
    const interval = pollIntervalMs({
      focused: true,
      servicesTabOpen: false,
      hasRunning: false,
    });
    expect(interval).not.toBeNull();
  });

  it("backs off when idle and speeds up when there is something to watch", () => {
    const idle = pollIntervalMs({
      focused: true,
      servicesTabOpen: false,
      hasRunning: false,
    });
    const running = pollIntervalMs({
      focused: true,
      servicesTabOpen: false,
      hasRunning: true,
    });
    const tabOpen = pollIntervalMs({
      focused: true,
      servicesTabOpen: true,
      hasRunning: false,
    });

    expect(running).toBe(tabOpen);
    expect(idle).toBeGreaterThan(running as number);
  });

  it("does not poll while the window is unfocused", () => {
    expect(
      pollIntervalMs({
        focused: false,
        servicesTabOpen: true,
        hasRunning: true,
      }),
    ).toBeNull();
  });
});
