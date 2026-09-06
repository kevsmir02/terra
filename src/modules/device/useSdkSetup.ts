import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SystemImage } from "./useAvds";

export type SdkSetup = {
  canInstall: boolean;
  /** Why not, when `canInstall` is false. */
  reason?: string;
  candidates: SystemImage[];
  /** Packages the install pulls in alongside the image, because they are
   *  missing too. */
  extraPackages: string[];
};

/**
 * `device_list_system_images` is a directory walk, not a network call, and this
 * only ticks while an install the user started is on screen. Slow enough that a
 * multi-minute download costs a handful of walks, fast enough that the panel
 * does not look dead once the image lands.
 */
const INSTALL_POLL_MS = 10_000;

/**
 * The offer to install an emulator, and the wait for one the user started.
 *
 * Terra never runs sdkmanager itself: it resolves the command and hands it to a
 * terminal tab, so the multi-gigabyte download and Google's licence prompts
 * happen in front of the user (`docs/adr/0004-sdk-install-runs-in-a-terminal-tab.md`).
 * That leaves no exit code to observe from here, so completion is the image
 * appearing on disk.
 */
export function useSdkSetup({
  runInTerminal,
  onInstalled,
}: {
  runInTerminal?: (command: string) => void;
  onInstalled: (pkg: string) => void | Promise<void>;
}) {
  const [setup, setSetup] = useState<SdkSetup | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so the poll below isn't re-subscribed on the caller's renders.
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;

  useEffect(() => {
    let cancelled = false;
    void invoke<SdkSetup>("device_sdk_setup")
      .then((s) => {
        if (!cancelled) setSetup(s);
      })
      .catch((e) => {
        if (cancelled) return;
        setSetup({
          canInstall: false,
          reason: String(e),
          candidates: [],
          extraPackages: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const check = useCallback(async () => {
    if (!installing) return;
    const images = await invoke<SystemImage[]>(
      "device_list_system_images",
    ).catch(() => [] as SystemImage[]);
    if (!images.some((i) => i.package === installing)) return;
    setInstalling(null);
    try {
      await onInstalledRef.current(installing);
    } catch (e) {
      setError(String(e));
    }
  }, [installing]);

  useEffect(() => {
    if (!installing) return;
    const id = setInterval(() => void check(), INSTALL_POLL_MS);
    return () => clearInterval(id);
  }, [installing, check]);

  const install = useCallback(
    async (pkg: string) => {
      if (!runInTerminal) return;
      setError(null);
      try {
        const command = await invoke<string>("device_sdk_install_command", {
          package: pkg,
        });
        runInTerminal(command);
        setInstalling(pkg);
      } catch (e) {
        setError(String(e));
      }
    },
    [runInTerminal],
  );

  return { setup, installing, error, install, check };
}
