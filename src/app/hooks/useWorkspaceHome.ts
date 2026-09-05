import { useCallback, useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { native } from "@/lib/native";

/**
 * Owns the resolved home and launch cwd. adoptWorkspaceHome re-authorizes
 * home when a space is restored or activated and returns it.
 */
export function useWorkspaceHome() {
  const [home, setHome] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);

  useEffect(() => {
    homeDir()
      .then(async (p) => {
        setHome(p);
        try {
          await native.workspaceAuthorize(p);
        } catch {
          // Bootstrap already authorizes home from Rust; ignore.
        }
      })
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  const adoptWorkspaceHome = useCallback(async (): Promise<string | null> => {
    let nextHome: string;
    try {
      nextHome = await homeDir();
    } catch {
      return null;
    }
    setHome(nextHome);
    setLaunchCwd(nextHome);
    try {
      await native.workspaceAuthorize(nextHome);
    } catch {
      // Non-fatal; the git panel surfaces "not authorized" if it matters.
    }
    return nextHome;
  }, []);

  return { home, launchCwd, launchCwdResolved, adoptWorkspaceHome };
}
