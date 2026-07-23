import { invoke } from "@tauri-apps/api/core";

// v1 input path: `adb shell input tap/swipe`. Single-touch only, ~50-100ms
// per event, no gesture composition. This is intentionally NOT the scrcpy
// binary control protocol — v1 runs the scrcpy server with `control=false`
// (no control socket exists), so `adb shell input` is the only input path.
// See spec "Input Bridge" and "v2 work" comments.

type PointerState = {
  startSerial: string;
  startX: number;
  startY: number;
  downAt: number;
};

let active: PointerState | null = null;

function deviceCoords(
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
  devW: number,
  devH: number,
): { x: number; y: number } {
  const rect = video.getBoundingClientRect();
  // object-contain: letterboxed inside the rect. Compute the displayed rect.
  const vw = devW || video.videoWidth || rect.width;
  const vh = devH || video.videoHeight || rect.height;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = rect.left + (rect.width - dispW) / 2;
  const offY = rect.top + (rect.height - dispH) / 2;
  const x = Math.round(((clientX - offX) / dispW) * vw);
  const y = Math.round(((clientY - offY) / dispH) * vh);
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

export const inputBridge = {
  onPointerDown(serial: string, devW: number, devH: number) {
    return (e: React.PointerEvent<HTMLVideoElement>) => {
      if (e.button !== 0) return;
      const { x, y } = deviceCoords(e.currentTarget, e.clientX, e.clientY, devW, devH);
      active = { startSerial: serial, startX: x, startY: y, downAt: Date.now() };
      e.currentTarget.setPointerCapture(e.pointerId);
      // Defer tap to pointerup — firing a tap on mousedown breaks hold+drag.
    };
  },
  onPointerMove(serial: string) {
    return (_e: React.PointerEvent<HTMLVideoElement>) => {
      // v1: no live drag — `adb shell input` is per-event. Drag is synthesized
      // as a single swipe from down-point to up-point on pointerup.
      void serial;
    };
  },
  onPointerUp(serial: string, devW: number, devH: number) {
    return (e: React.PointerEvent<HTMLVideoElement>) => {
      if (!active || active.startSerial !== serial) {
        active = null;
        return;
      }
      const { x, y } = deviceCoords(e.currentTarget, e.clientX, e.clientY, devW, devH);
      const dx = Math.abs(x - active.startX);
      const dy = Math.abs(y - active.startY);
      const duration = Math.max(50, Math.min(500, Date.now() - active.downAt));
      if (dx > 4 || dy > 4) {
        void invoke("device_input_swipe", {
          serial,
          x1: active.startX,
          y1: active.startY,
          x2: x,
          y2: y,
          durationMs: duration,
        }).catch(() => {});
      }
      active = null;
    };
  },
};
