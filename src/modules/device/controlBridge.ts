import { invoke } from "@tauri-apps/api/core";
import type React from "react";

export function scaleCoordinates(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  deviceWidth: number,
  deviceHeight: number,
) {
  const relX = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const relY = Math.max(0, Math.min(clientY - rect.top, rect.height));

  const x = Math.round((relX / rect.width) * deviceWidth);
  const y = Math.round((relY / rect.height) * deviceHeight);

  return { x, y, width: deviceWidth, height: deviceHeight };
}

function scheduleFrame(cb: () => void): number {
  if (typeof requestAnimationFrame !== "undefined") {
    return requestAnimationFrame(cb);
  }
  return setTimeout(cb, 16) as unknown as number;
}

export class DeviceControlBridge {
  private handle: number;
  private deviceWidth: number;
  private deviceHeight: number;
  private rafId: number | null = null;
  private pendingMove: { clientX: number; clientY: number; rect: DOMRect; pointerId: number } | null = null;

  constructor(handle: number, deviceWidth = 1080, deviceHeight = 1920) {
    this.handle = handle;
    this.deviceWidth = deviceWidth;
    this.deviceHeight = deviceHeight;
  }

  public handlePointerDown(e: React.PointerEvent<HTMLVideoElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y, width, height } = scaleCoordinates(
      e.clientX,
      e.clientY,
      rect,
      this.deviceWidth,
      this.deviceHeight,
    );
    void invoke("device_send_touch", {
      handle: this.handle,
      action: 0, // Down
      pointerId: e.pointerId,
      x,
      y,
      width,
      height,
    }).catch((err) => console.error("[controlBridge] send_touch down failed:", err));
  }

  public handlePointerMove(e: React.PointerEvent<HTMLVideoElement>) {
    if (e.buttons === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    this.pendingMove = { clientX: e.clientX, clientY: e.clientY, rect, pointerId: e.pointerId };

    if (!this.rafId) {
      this.rafId = scheduleFrame(() => {
        this.rafId = null;
        if (!this.pendingMove) return;
        const { clientX, clientY, rect: r, pointerId } = this.pendingMove;
        const { x, y, width, height } = scaleCoordinates(
          clientX,
          clientY,
          r,
          this.deviceWidth,
          this.deviceHeight,
        );
        void invoke("device_send_touch", {
          handle: this.handle,
          action: 2, // Move
          pointerId,
          x,
          y,
          width,
          height,
        }).catch((err) => console.error("[controlBridge] send_touch move failed:", err));
      });
    }
  }

  public handlePointerUp(e: React.PointerEvent<HTMLVideoElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y, width, height } = scaleCoordinates(
      e.clientX,
      e.clientY,
      rect,
      this.deviceWidth,
      this.deviceHeight,
    );
    void invoke("device_send_touch", {
      handle: this.handle,
      action: 1, // Up
      pointerId: e.pointerId,
      x,
      y,
      width,
      height,
    }).catch((err) => console.error("[controlBridge] send_touch up failed:", err));
  }

  public sendKey(keycode: number, action = 0) {
    void invoke("device_send_key", {
      handle: this.handle,
      keycode,
      action,
    }).catch((err) => console.error("[controlBridge] send_key failed:", err));
  }
}
