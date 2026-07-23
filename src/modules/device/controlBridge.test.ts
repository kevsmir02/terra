import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { scaleCoordinates, DeviceControlBridge } from "./controlBridge";
import { invoke } from "@tauri-apps/api/core";
import type React from "react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe("scaleCoordinates", () => {
  it("scales client coordinates to target device resolution", () => {
    const clientX = 100;
    const clientY = 200;
    const rect = { left: 0, top: 0, width: 500, height: 1000 } as DOMRect;
    const deviceW = 1080;
    const deviceH = 2160;

    const scaled = scaleCoordinates(clientX, clientY, rect, deviceW, deviceH);
    expect(scaled.x).toBe(216);
    expect(scaled.y).toBe(432);
    expect(scaled.width).toBe(1080);
    expect(scaled.height).toBe(2160);
  });

  it("clamps coordinates within element bounds", () => {
    const rect = { left: 10, top: 10, width: 100, height: 200 } as DOMRect;

    // Below min bound
    const minScaled = scaleCoordinates(0, 0, rect, 1000, 2000);
    expect(minScaled.x).toBe(0);
    expect(minScaled.y).toBe(0);

    // Above max bound
    const maxScaled = scaleCoordinates(200, 300, rect, 1000, 2000);
    expect(maxScaled.x).toBe(1000);
    expect(maxScaled.y).toBe(2000);
  });
});

describe("DeviceControlBridge", () => {
  let bridge: DeviceControlBridge;
  const mockRect = { left: 0, top: 0, width: 500, height: 1000 } as DOMRect;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    bridge = new DeviceControlBridge(42, 1080, 2000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles pointer down event correctly", () => {
    const event = {
      clientX: 250,
      clientY: 500,
      pointerId: 1,
      currentTarget: {
        getBoundingClientRect: () => mockRect,
      },
    } as unknown as React.PointerEvent<HTMLVideoElement>;

    bridge.handlePointerDown(event);

    expect(invoke).toHaveBeenCalledWith("device_send_touch", {
      handle: 42,
      action: 0,
      pointerId: 1,
      x: 540,
      y: 1000,
      width: 1080,
      height: 2000,
    });
  });

  it("throttles pointer move events using requestAnimationFrame", () => {
    const event1 = {
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      currentTarget: {
        getBoundingClientRect: () => mockRect,
      },
    } as unknown as React.PointerEvent<HTMLVideoElement>;

    const event2 = {
      buttons: 1,
      clientX: 200,
      clientY: 200,
      pointerId: 1,
      currentTarget: {
        getBoundingClientRect: () => mockRect,
      },
    } as unknown as React.PointerEvent<HTMLVideoElement>;

    bridge.handlePointerMove(event1);
    bridge.handlePointerMove(event2);

    // RAF has not fired yet, invoke should not have been called for moves
    expect(invoke).not.toHaveBeenCalled();

    // Trigger RAF
    vi.runAllTimers();

    // Only the last pending move (event2) should be dispatched
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("device_send_touch", {
      handle: 42,
      action: 2,
      pointerId: 1,
      x: 432,
      y: 400,
      width: 1080,
      height: 2000,
    });
  });

  it("ignores pointer move when no buttons are pressed", () => {
    const event = {
      buttons: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      currentTarget: {
        getBoundingClientRect: () => mockRect,
      },
    } as unknown as React.PointerEvent<HTMLVideoElement>;

    bridge.handlePointerMove(event);
    vi.runAllTimers();

    expect(invoke).not.toHaveBeenCalled();
  });

  it("handles pointer up event correctly", () => {
    const event = {
      clientX: 250,
      clientY: 500,
      pointerId: 1,
      currentTarget: {
        getBoundingClientRect: () => mockRect,
      },
    } as unknown as React.PointerEvent<HTMLVideoElement>;

    bridge.handlePointerUp(event);

    expect(invoke).toHaveBeenCalledWith("device_send_touch", {
      handle: 42,
      action: 1,
      pointerId: 1,
      x: 540,
      y: 1000,
      width: 1080,
      height: 2000,
    });
  });

  it("sends key events correctly", () => {
    bridge.sendKey(3, 0);

    expect(invoke).toHaveBeenCalledWith("device_send_key", {
      handle: 42,
      keycode: 3,
      action: 0,
    });
  });
});
