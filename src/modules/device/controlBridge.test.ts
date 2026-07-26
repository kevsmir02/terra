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

describe("scaleCoordinates letterboxing", () => {
  // Regression: the map used the raw element rect, ignoring that `object-contain`
  // letterboxes the picture. Any pane whose aspect ratio differed from the
  // device's skewed every coordinate by the bar size.
  it("subtracts the letterbox bars when aspect ratios differ", () => {
    // 1080x2000 (0.54) inside a 500x1000 element (0.50) => 37px bars top/bottom.
    const rect = { left: 0, top: 0, width: 500, height: 1000 } as DOMRect;

    // Centre of the element is the centre of the picture.
    expect(scaleCoordinates(250, 500, rect, 1080, 2000)).toMatchObject({ x: 540, y: 1000 });

    // Top of the *element* is inside the bar, so it clamps to the picture's top
    // edge rather than reporting a negative or skewed y.
    expect(scaleCoordinates(250, 0, rect, 1080, 2000).y).toBe(0);
    expect(scaleCoordinates(250, 1000, rect, 1080, 2000).y).toBe(2000);
  });

  it("reports the video size it was given, since scrcpy matches on it exactly", () => {
    const rect = { left: 0, top: 0, width: 500, height: 1000 } as DOMRect;
    const out = scaleCoordinates(100, 100, rect, 864, 1920);
    expect(out.width).toBe(864);
    expect(out.height).toBe(1920);
  });
});

describe("DeviceControlBridge", () => {
  let bridge: DeviceControlBridge;
  const mockRect = { left: 0, top: 0, width: 500, height: 1000 } as DOMRect;

  function pointerEvent(over: {
    clientX: number;
    clientY: number;
    pointerId?: number;
    buttons?: number;
  }) {
    return {
      buttons: 1,
      pointerId: 1,
      ...over,
      currentTarget: { getBoundingClientRect: () => mockRect },
    } as unknown as React.PointerEvent<HTMLVideoElement>;
  }

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
    bridge.handlePointerDown(pointerEvent({ clientX: 0, clientY: 0 }));
    vi.mocked(invoke).mockClear();

    bridge.handlePointerMove(pointerEvent({ clientX: 100, clientY: 100 }));
    bridge.handlePointerMove(pointerEvent({ clientX: 200, clientY: 200 }));

    // RAF has not fired yet, invoke should not have been called for moves
    expect(invoke).not.toHaveBeenCalled();

    // Trigger RAF
    vi.runAllTimers();

    // Only the last pending move should be dispatched. y accounts for the
    // object-contain letterbox: a 1080x2000 picture inside a 500x1000 element
    // leaves a 37px bar top and bottom.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("device_send_touch", {
      handle: 42,
      action: 2,
      pointerId: 1,
      x: 432,
      y: 352,
      width: 1080,
      height: 2000,
    });
  });

  it("ignores pointer move when no buttons are pressed", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 0, clientY: 0 }));
    vi.mocked(invoke).mockClear();

    bridge.handlePointerMove(pointerEvent({ clientX: 100, clientY: 100, buttons: 0 }));
    vi.runAllTimers();

    expect(invoke).not.toHaveBeenCalled();
  });

  it("ignores pointer move from a pointer that is not the active one", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 0, clientY: 0, pointerId: 1 }));
    vi.mocked(invoke).mockClear();

    bridge.handlePointerMove(pointerEvent({ clientX: 100, clientY: 100, pointerId: 2 }));
    vi.runAllTimers();

    expect(invoke).not.toHaveBeenCalled();
  });

  // Regression: a move coalesced into the next frame used to survive the up and
  // arrive after it, leaving the device latched as still-touching.
  it("drops a queued move when the gesture ends before the frame fires", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 0, clientY: 0 }));
    bridge.handlePointerMove(pointerEvent({ clientX: 100, clientY: 100 }));
    bridge.handlePointerUp(pointerEvent({ clientX: 250, clientY: 500 }));
    vi.mocked(invoke).mockClear();

    vi.runAllTimers();

    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the up as the final touch of a gesture", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 0, clientY: 0 }));
    bridge.handlePointerMove(pointerEvent({ clientX: 100, clientY: 100 }));
    bridge.handlePointerUp(pointerEvent({ clientX: 250, clientY: 500 }));

    const actions = vi.mocked(invoke).mock.calls.map((c) => (c[1] as { action: number }).action);
    expect(actions[actions.length - 1]).toBe(1);
  });

  it("tracks two fingers independently and coalesces both into one frame", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }));
    bridge.handlePointerDown(pointerEvent({ clientX: 400, clientY: 800, pointerId: 2 }));
    expect(bridge.activePointerCount).toBe(2);
    vi.mocked(invoke).mockClear();

    // Both fingers move within the same frame; each keeps its own latest point.
    bridge.handlePointerMove(pointerEvent({ clientX: 150, clientY: 150, pointerId: 1 }));
    bridge.handlePointerMove(pointerEvent({ clientX: 350, clientY: 750, pointerId: 2 }));
    bridge.handlePointerMove(pointerEvent({ clientX: 200, clientY: 200, pointerId: 1 }));
    vi.runAllTimers();

    const moves = vi
      .mocked(invoke)
      .mock.calls.map((c) => c[1] as { pointerId: number; action: number; x: number; y: number });
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.action === 2)).toBe(true);
    expect(moves.find((m) => m.pointerId === 1)).toMatchObject({ x: 432, y: 352 });
    expect(moves.find((m) => m.pointerId === 2)).toMatchObject({ x: 756, y: 1540 });
  });

  it("keeps the other finger's queued move when one finger lifts", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }));
    bridge.handlePointerDown(pointerEvent({ clientX: 400, clientY: 800, pointerId: 2 }));
    bridge.handlePointerMove(pointerEvent({ clientX: 150, clientY: 150, pointerId: 1 }));
    bridge.handlePointerMove(pointerEvent({ clientX: 350, clientY: 750, pointerId: 2 }));
    bridge.handlePointerUp(pointerEvent({ clientX: 150, clientY: 150, pointerId: 1 }));
    vi.mocked(invoke).mockClear();

    vi.runAllTimers();

    const calls = vi.mocked(invoke).mock.calls.map((c) => c[1] as { pointerId: number; action: number });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ pointerId: 2, action: 2 });
    expect(bridge.activePointerCount).toBe(1);
  });

  it("ignores an up for a pointer that was never down", () => {
    bridge.handlePointerUp(pointerEvent({ clientX: 100, clientY: 100, pointerId: 9 }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("releases every held finger on teardown", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }));
    bridge.handlePointerDown(pointerEvent({ clientX: 400, clientY: 800, pointerId: 2 }));
    vi.mocked(invoke).mockClear();

    bridge.releaseAll();

    const ups = vi.mocked(invoke).mock.calls.map((c) => c[1] as { pointerId: number; action: number });
    expect(ups).toHaveLength(2);
    expect(ups.every((u) => u.action === 1)).toBe(true);
    expect(ups.map((u) => u.pointerId).sort()).toEqual([1, 2]);
    expect(bridge.activePointerCount).toBe(0);

    // A frame queued before teardown must not fire afterwards.
    vi.mocked(invoke).mockClear();
    vi.runAllTimers();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("releases the touch on pointer cancel", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 0, clientY: 0 }));
    vi.mocked(invoke).mockClear();

    bridge.handlePointerCancel(pointerEvent({ clientX: 250, clientY: 500 }));

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

  it("handles pointer up event correctly", () => {
    bridge.handlePointerDown(pointerEvent({ clientX: 0, clientY: 0 }));
    vi.mocked(invoke).mockClear();

    bridge.handlePointerUp(pointerEvent({ clientX: 250, clientY: 500 }));

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

  // `metastate` is required by the Rust command; omitting it fails argument
  // deserialization before the handler runs.
  it("sends key events with every argument the backend requires", () => {
    bridge.sendKey(3, 0);

    expect(invoke).toHaveBeenCalledWith("device_send_key", {
      handle: 42,
      keycode: 3,
      action: 0,
      metastate: 0,
    });
  });

  it("presses a key as a down/up pair", () => {
    bridge.pressKey(4);

    expect(invoke).toHaveBeenNthCalledWith(1, "device_send_key", {
      handle: 42,
      keycode: 4,
      action: 0,
      metastate: 0,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "device_send_key", {
      handle: 42,
      keycode: 4,
      action: 1,
      metastate: 0,
    });
  });

  // Regression: the pane fed the bridge the PHYSICAL size from `wm size`
  // (1080x2400), but scrcpy compares each touch's width/height against the
  // ENCODED video size (864x1920 under max_size=1920) and silently discards
  // any mismatch. Verified against scrcpy 4.1 on a live emulator: 864x1920
  // works; 1080x2400, 880x1920 and 864x1912 are all dropped without error.
  it("sends the encoded video size, and tracks it across rotation", () => {
    bridge.setVideoSize(864, 1920);
    bridge.handlePointerDown(pointerEvent({ clientX: 250, clientY: 500 }));

    let args = vi.mocked(invoke).mock.calls[0][1] as { width: number; height: number };
    expect(args).toMatchObject({ width: 864, height: 1920 });

    // A rotation re-encodes at swapped dimensions; without tracking it, touch
    // would silently stop working until the tab was reopened.
    vi.mocked(invoke).mockClear();
    bridge.setVideoSize(1920, 864);
    bridge.handlePointerDown(pointerEvent({ clientX: 250, clientY: 500, pointerId: 5 }));
    args = vi.mocked(invoke).mock.calls[0][1] as { width: number; height: number };
    expect(args).toMatchObject({ width: 1920, height: 864 });
  });

  it("ignores a zero video size rather than poisoning the coordinate space", () => {
    // videoWidth/videoHeight are 0 until the first frame decodes.
    bridge.setVideoSize(0, 0);
    bridge.handlePointerDown(pointerEvent({ clientX: 250, clientY: 500 }));
    const args = vi.mocked(invoke).mock.calls[0][1] as { width: number; height: number };
    expect(args.width).toBe(1080);
    expect(args.height).toBe(2000);
  });

  it("sends scroll with the vertical axis inverted for Android", () => {
    bridge.handleWheel({
      clientX: 250,
      clientY: 500,
      deltaX: 0,
      deltaY: 120,
      currentTarget: { getBoundingClientRect: () => mockRect },
    } as unknown as React.WheelEvent<HTMLVideoElement>);

    expect(invoke).toHaveBeenCalledWith("device_send_scroll", {
      handle: 42,
      x: 540,
      y: 1000,
      width: 1080,
      height: 2000,
      h: 0,
      v: -3,
    });
  });

  it("does not inject a vertical click for a purely horizontal wheel", () => {
    bridge.handleWheel({
      clientX: 250,
      clientY: 500,
      deltaX: 120,
      deltaY: 0,
      currentTarget: { getBoundingClientRect: () => mockRect },
    } as unknown as React.WheelEvent<HTMLVideoElement>);

    const args = vi.mocked(invoke).mock.calls[0][1] as { v: number; h: number };
    expect(args.v).toBe(0);
    expect(args.h).toBe(-3);
  });

  it("still scrolls one click for sub-threshold wheel deltas", () => {
    bridge.handleWheel({
      clientX: 250,
      clientY: 500,
      deltaX: 0,
      deltaY: 4,
      currentTarget: { getBoundingClientRect: () => mockRect },
    } as unknown as React.WheelEvent<HTMLVideoElement>);

    const args = vi.mocked(invoke).mock.calls[0][1] as { v: number };
    expect(args.v).toBe(-1);
  });
});
