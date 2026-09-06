import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";

async function anyTerminalBusy(tabs: Tab[]): Promise<boolean> {
  const leaves = tabs.flatMap((t) =>
    t.kind === "terminal" ? leafIds(t.paneTree) : [],
  );
  if (leaves.length === 0) return false;
  const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
  return checks.some(Boolean);
}

export type AppCloseBlocker = {
  dirtyEditors: number;
  busyTerminal: boolean;
};

const CLOSE_FLUSH_TIMEOUT_MS = 1500;

type Options = {
  /** Runs once a close is decided, before the window goes; bounded by a deadline. */
  beforeClose?: () => Promise<void>;
};

export function useAppCloseGuard(
  tabsRef: RefObject<Tab[]>,
  { beforeClose }: Options = {},
) {
  const [pendingAppClose, setPendingAppClose] =
    useState<AppCloseBlocker | null>(null);
  const forceClose = useRef(false);
  const beforeCloseRef = useRef(beforeClose);
  beforeCloseRef.current = beforeClose;

  const closeNow = useCallback(async () => {
    forceClose.current = true;
    const work = beforeCloseRef.current?.().catch(() => undefined);
    if (work) {
      await Promise.race([
        work,
        new Promise<void>((resolve) =>
          setTimeout(resolve, CLOSE_FLUSH_TIMEOUT_MS),
        ),
      ]);
    }
    void getCurrentWindow().close();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (forceClose.current) return;
        event.preventDefault();
        const busyTerminal = await anyTerminalBusy(tabsRef.current);
        // Count after the await so edits made during the IPC check are seen.
        const dirtyEditors = tabsRef.current.filter(
          (t) => t.kind === "editor" && t.dirty,
        ).length;
        if (dirtyEditors > 0 || busyTerminal) {
          setPendingAppClose({ dirtyEditors, busyTerminal });
        } else {
          void closeNow();
        }
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [tabsRef, closeNow]);

  const confirmAppClose = useCallback(() => {
    setPendingAppClose(null);
    void closeNow();
  }, [closeNow]);

  const cancelAppClose = useCallback(() => setPendingAppClose(null), []);

  return { pendingAppClose, confirmAppClose, cancelAppClose };
}
