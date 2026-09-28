import { useCallback, useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { native } from "@/lib/native";

/**
 * Owns the resolved home and launch cwd. adoptWorkspaceHome resets the launch
 * cwd to home when a space is restored or activated and returns it. Home is a
 * root from Rust's bootstrap, so nothing here grants anything.
 */
export function useWorkspaceHome() {
  const [home, setHome] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);

  useEffect(() => {
    homeDir()
      .then(setHome)
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
    return nextHome;
  }, []);

  return { home, launchCwd, launchCwdResolved, adoptWorkspaceHome };
}
