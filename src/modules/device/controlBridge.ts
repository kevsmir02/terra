import { invoke } from "@tauri-apps/api/core";
import type React from "react";

// Android `KEYCODE_*` values injected verbatim via the scrcpy control socket.
export const DEVICE_KEYCODE = {
  HOME: 3,
  BACK: 4,
  APP_SWITCH: 187,
} as const;

/**
 * Map a client point to scrcpy's coordinate space.
 *
 * `videoWidth`/`videoHeight` MUST be the encoded video dimensions, not the
 * device's physical size. scrcpy's `getPhysicalPoint` compares the width/height
 * carried by each touch against the current video size and *silently discards*
 * the event when they differ - no error, no log. A device that downscales via
 * `max_size` encodes below its physical resolution: with `max_size=1920` a
 * 1080x2400 device encodes at 864x1920, so sending physical dimensions drops
 * every touch. Verified against scrcpy 4.1: 864x1920 works, and 1080x2400,
 * 880x1920 and 864x1912 are all dropped.
 *
 * The `<video>` is `object-contain`, so the picture is letterboxed inside the
 * element. Mapping against the raw element rect would skew every coordinate by
 * the bar size whenever the pane's aspect ratio differs from the device's.
 */
export function scaleCoordinates(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  videoWidth: number,
  videoHeight: number,
) {
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const shownW = videoWidth * scale;
  const shownH = videoHeight * scale;
  const barX = (rect.width - shownW) / 2;
  const barY = (rect.height - shownH) / 2;

  // Points in the letterbox bars clamp to the nearest edge of the picture.
  const relX = Math.max(0, Math.min(clientX - rect.left - barX, shownW));
  const relY = Math.max(0, Math.min(clientY - rect.top - barY, shownH));

  const x = Math.round(relX / scale);
  const y = Math.round(relY / scale);

  return { x, y, width: videoWidth, height: videoHeight };
}

function scheduleFrame(cb: () => void): number {
  if (typeof requestAnimationFrame !== "undefined") {
    return requestAnimationFrame(cb);
  }
  return setTimeout(cb, 16) as unknown as number;
}

function cancelFrame(id: number) {
  if (typeof cancelAnimationFrame !== "undefined") {
    cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

// Edge swipes (the Android 10+ Back/Home gestures) leave the <video> bounds
// almost immediately, and without capture the element stops receiving moves
// mid-gesture and never sees the up. Guarded because test doubles and
// non-DOM targets don't implement the pointer-capture API.
function capturePointer(el: Element, pointerId: number) {
  if (typeof el.setPointerCapture !== "function") return;
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* pointer already gone */
  }
}

function releasePointer(el: Element, pointerId: number) {
  if (typeof el.releasePointerCapture !== "function") return;
  try {
    el.releasePointerCapture(pointerId);
  } catch {
    /* never captured, or already released */
  }
}

// scrcpy takes scroll as discrete clicks, while wheel deltas are pixels that
// grow downward, Android's axes point the other way, hence the negation. A
// small-but-nonzero delta still has to move one click or fine-grained trackpad
// scrolling does nothing. Returning early on a zero delta keeps a horizontal
// wheel event from injecting a phantom vertical click, and avoids the `-0`
// that `Math.round` would otherwise produce.
function wheelClicks(delta: number): number {
  if (delta === 0) return 0;
  const clicks = Math.max(-16, Math.min(16, Math.round(-delta / 40)));
  return clicks || (delta > 0 ? -1 : 1);
}

export class DeviceControlBridge {
  private handle: number;
  private deviceWidth: number;
  private deviceHeight: number;
  private rafId: number | null = null;
  // Keyed by pointerId so several fingers can be in flight at once: scrcpy
  // distinguishes pointers purely by the id on the wire, so a distinct id per
  // contact is all Android needs to see a real multi-touch gesture.
  private pendingMoves = new Map<
    number,
    { clientX: number; clientY: number; rect: DOMRect }
  >();
  private activePointers = new Map<number, { x: number; y: number }>();

  constructor(handle: number, deviceWidth = 1080, deviceHeight = 1920) {
    this.handle = handle;
    this.deviceWidth = deviceWidth;
    this.deviceHeight = deviceHeight;
  }

  /**
   * Track the encoded video size. Must be kept in sync with the `<video>`'s
   * `videoWidth`/`videoHeight`, including after a device rotation, which
   * re-encodes at swapped dimensions and would otherwise silently break touch
   * until the tab is reopened.
   */
  public setVideoSize(width: number, height: number) {
    if (width > 0 && height > 0) {
      this.deviceWidth = width;
      this.deviceHeight = height;
    }
  }

  private sendTouch(
    action: 0 | 1 | 2,
    pointerId: number,
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ) {
    const { x, y, width, height } = scaleCoordinates(
      clientX,
      clientY,
      rect,
      this.deviceWidth,
      this.deviceHeight,
    );
    if (action === 1) {
      this.activePointers.delete(pointerId);
    } else {
      this.activePointers.set(pointerId, { x, y });
    }
    void invoke("device_send_touch", {
      handle: this.handle,
      action,
      pointerId,
      x,
      y,
      width,
      height,
    }).catch((err) => console.error("[controlBridge] send_touch failed:", err));
  }

  private flushMoves() {
    this.rafId = null;
    const queued = [...this.pendingMoves];
    this.pendingMoves.clear();
    for (const [pointerId, p] of queued) {
      this.sendTouch(2, pointerId, p.clientX, p.clientY, p.rect);
    }
  }

  private scheduleFlush() {
    if (this.rafId === null) {
      this.rafId = scheduleFrame(() => this.flushMoves());
    }
  }

  // A move coalesced into the next frame must never outlive its own gesture: if
  // the up lands first the device would see Down -> Up -> Move and treat that
  // finger as still held. The up carries the authoritative final position, so
  // dropping the queued move loses nothing. Only this pointer's move is
  // discarded, other fingers still down keep theirs.
  private discardPendingMove(pointerId: number) {
    this.pendingMoves.delete(pointerId);
    if (this.pendingMoves.size === 0 && this.rafId !== null) {
      cancelFrame(this.rafId);
      this.rafId = null;
    }
  }

  private endGesture(e: React.PointerEvent<HTMLVideoElement>) {
    if (!this.activePointers.has(e.pointerId)) return;
    this.discardPendingMove(e.pointerId);
    const target = e.currentTarget;
    this.sendTouch(
      1,
      e.pointerId,
      e.clientX,
      e.clientY,
      target.getBoundingClientRect(),
    );
    releasePointer(target, e.pointerId);
  }

  public handlePointerDown(e: React.PointerEvent<HTMLVideoElement>) {
    this.discardPendingMove(e.pointerId);
    capturePointer(e.currentTarget, e.pointerId);
    this.sendTouch(
      0,
      e.pointerId,
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
    );
  }

  public handlePointerMove(e: React.PointerEvent<HTMLVideoElement>) {
    if (!this.activePointers.has(e.pointerId)) return;
    if (e.buttons === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    this.pendingMoves.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      rect,
    });
    this.scheduleFlush();
  }

  // Number of fingers currently down. Exposed for tests and diagnostics.
  public get activePointerCount() {
    return this.activePointers.size;
  }

  // Tearing the session down while a finger is held would otherwise leave the
  // device latched mid-touch, since no up ever arrives. Replays the last known
  // position of each live pointer as an up.
  public releaseAll() {
    if (this.rafId !== null) {
      cancelFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingMoves.clear();
    for (const [pointerId, last] of [...this.activePointers]) {
      this.activePointers.delete(pointerId);
      void invoke("device_send_touch", {
        handle: this.handle,
        action: 1,
        pointerId,
        x: last.x,
        y: last.y,
        width: this.deviceWidth,
        height: this.deviceHeight,
      }).catch((err) =>
        console.error("[controlBridge] release_all failed:", err),
      );
    }
  }

  public handlePointerUp(e: React.PointerEvent<HTMLVideoElement>) {
    this.endGesture(e);
  }

  // Without this the device stays latched in a pressed state whenever the
  // browser takes the gesture over (scroll handoff, capture loss, window blur).
  public handlePointerCancel(e: React.PointerEvent<HTMLVideoElement>) {
    this.endGesture(e);
  }

  public handleWheel(e: React.WheelEvent<HTMLVideoElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y, width, height } = scaleCoordinates(
      e.clientX,
      e.clientY,
      rect,
      this.deviceWidth,
      this.deviceHeight,
    );
    const v = wheelClicks(e.deltaY);
    const h = wheelClicks(e.deltaX);
    void invoke("device_send_scroll", {
      handle: this.handle,
      x,
      y,
      width,
      height,
      h,
      v,
    }).catch((err) =>
      console.error("[controlBridge] send_scroll failed:", err),
    );
  }

  // `metastate` is non-optional on the Rust side; omitting it fails argument
  // deserialization before the command body ever runs.
  public sendKey(keycode: number, action = 0, metastate = 0) {
    void invoke("device_send_key", {
      handle: this.handle,
      keycode,
      action,
      metastate,
    }).catch((err) => console.error("[controlBridge] send_key failed:", err));
  }

  // Android only acts on a key once it sees the matching up.
  public pressKey(keycode: number) {
    this.sendKey(keycode, 0);
    this.sendKey(keycode, 1);
  }
}
