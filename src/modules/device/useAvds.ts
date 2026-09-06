import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";

const AVD_BOOT_EVENT = "device:avd-boot";

export type AvdEntry = {
  name: string;
  /** Serial of the running instance; absent when the AVD is not booted. */
  serial?: string;
  /** True when Terra started it, and may therefore stop it again. */
  managed: boolean;
};

export type BootPhase =
  | "starting"
  | "waiting-for-device"
  | "booting"
  | "ready"
  | "failed";

export type AvdBootEvent = {
  name: string;
  serial: string;
  phase: BootPhase;
  message?: string;
};

export type SystemImage = {
  package: string;
  apiLevel: string;
  tag: string;
  abi: string;
};

export const BOOT_PHASE_LABEL: Record<BootPhase, string> = {
  starting: "Starting…",
  "waiting-for-device": "Waiting for device…",
  booting: "Booting Android…",
  ready: "Ready",
  failed: "Failed",
};

/**
 * Shared AVD list + lifecycle. Boot is reported by the backend as
 * `device:avd-boot` events rather than polled, because a cold boot can take
 * minutes and any fixed timeout is either a wrong guess or a long stall.
 */
export function useAvds(onReady?: (serial: string) => void) {
  const [avds, setAvds] = useState<AvdEntry[] | null>(null);
  const [boot, setBoot] = useState<AvdBootEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Kept in a ref so re-subscribing isn't tied to the caller's render cycle.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const refresh = useCallback(async () => {
    try {
      setAvds(await invoke<AvdEntry[]>("device_list_avds"));
    } catch {
      // No emulator package installed is a normal state, not an error to show.
      setAvds([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unlisten = getCurrentWebviewWindow().listen<AvdBootEvent>(
      AVD_BOOT_EVENT,
      (e) => {
        const payload = e.payload;
        if (payload.phase === "ready") {
          setBoot(null);
          setBusy(false);
          void refresh();
          onReadyRef.current?.(payload.serial);
          return;
        }
        if (payload.phase === "failed") {
          setBoot(null);
          setBusy(false);
          setError(payload.message ?? `${payload.name} failed to start`);
          void refresh();
          return;
        }
        setBoot(payload);
      },
    );
    return () => {
      void unlisten.then((off) => off());
    };
  }, [refresh]);

  const launch = useCallback(async (name: string) => {
    setError(null);
    setBusy(true);
    setBoot({ name, serial: "", phase: "starting" });
    try {
      await invoke<string>("device_launch_avd", { name });
    } catch (e) {
      setError(String(e));
      setBoot(null);
      setBusy(false);
    }
  }, []);

  const stop = useCallback(
    async (serial: string) => {
      setError(null);
      setBusy(true);
      try {
        await invoke("device_stop_avd", { serial });
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (name: string, pkg: string) => {
      setError(null);
      setBusy(true);
      try {
        await invoke("device_create_avd", { name, package: pkg });
        await refresh();
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { avds, boot, error, busy, refresh, launch, stop, create };
}

export async function listSystemImages(): Promise<SystemImage[]> {
  return invoke<SystemImage[]>("device_list_system_images").catch(() => []);
}
