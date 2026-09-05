import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { DeviceEntry } from "./generated/DeviceEntry";

export const DOCK_DEFAULT_WIDTH = 340;
export const DOCK_MIN_WIDTH = 240;
export const DOCK_MAX_WIDTH = 640;

const DOCK_WIDTH_STORAGE_KEY = "terra.deviceDock.width";

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(width)));
}

export function readDockWidth(): number {
  try {
    const stored = window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampDockWidth(parsed) : DOCK_DEFAULT_WIDTH;
  } catch {
    return DOCK_DEFAULT_WIDTH;
  }
}

/**
 * Dock state, mirroring useSidebarPanel. The docked device is deliberately not
 * persisted: reconnecting on startup to a device that has since disappeared
 * surfaces an error before the user has done anything.
 */
export function useDeviceDock() {
  const dockRef = useRef<PanelImperativeHandle | null>(null);
  const dockWidthRef = useRef(readDockWidth());
  const widthWriteTimerRef = useRef(0);
  const [device, setDevice] = useState<DeviceEntry | null>(null);

  const persistDockWidth = useCallback((next: number) => {
    const clamped = clampDockWidth(next);
    dockWidthRef.current = clamped;
    if (widthWriteTimerRef.current) window.clearTimeout(widthWriteTimerRef.current);
    widthWriteTimerRef.current = window.setTimeout(() => {
      widthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(clamped));
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (widthWriteTimerRef.current) window.clearTimeout(widthWriteTimerRef.current);
    };
  }, []);

  // Picking the already-docked device just re-expands it, so the live scrcpy
  // session is reused instead of being torn down and restarted.
  const dockDevice = useCallback((next: DeviceEntry) => {
    setDevice(next);
    dockRef.current?.resize(`${dockWidthRef.current}px`);
  }, []);

  const stopDevice = useCallback(() => {
    setDevice(null);
    dockRef.current?.collapse();
  }, []);

  return {
    dockRef,
    dockWidthRef,
    device,
    dockDevice,
    stopDevice,
    persistDockWidth,
  };
}

export type UseDeviceDock = ReturnType<typeof useDeviceDock>;
export type DockPanelRef = RefObject<PanelImperativeHandle | null>;
