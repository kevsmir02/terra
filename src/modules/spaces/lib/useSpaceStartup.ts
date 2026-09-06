import type { PanelImperativeHandle } from "react-resizable-panels";
import type { MutableRefObject } from "react";
import { useSpaces } from "./useSpaces";
import { submitToNewTab } from "@/modules/terminal";
import type { Tab } from "@/modules/tabs";
import { useEffect, useRef } from "react";

type Params = {
  /** True once spaces are hydrated from disk and the app is booted. */
  ready: boolean;
  /** The currently active space id (drives both boot-first-run and switch runs). */
  activeSpaceId: string | null;
  /** Latest tabs snapshot, for resolving leafIds of newly created terminal tabs. */
  tabsRef: MutableRefObject<Tab[]>;
  /** Sets the active tab id; used to warm a cold terminal so its pane mounts. */
  setActiveId: (id: number) => void;
  /** Creates a cold terminal tab in the given space (returns its tabId). */
  newTerminalInSpace: (
    spaceId: string,
    cwd?: string,
    startupCommand?: string,
  ) => number;
  /** Live sidebar panel handle; null while the panel is not yet mounted. */
  sidebarRef: MutableRefObject<PanelImperativeHandle | null>;
  /** Ref holding the most recent sidebar width in pixels (for clamp checks). */
  sidebarMinPct: number;
  sidebarMaxPct: number;
};

/**
 * Owns two switch-time side-effects of project profiles:
 *   1. Apply the active space's persisted panelSizes (sidebar|workspace ratio) by
 *      resizing the sidebar panel; uncustomized spaces are left untouched.
 *   2. On first per-session activation of a space, create one cold terminal per
 *      startupCommand, warm it by focusing it, then submit the command to its
 *      leaf on the next tick. Idempotent per-space via a Set ref - switching
 *      back does not re-run.
 */
export function useSpaceStartup({
  ready,
  activeSpaceId,
  tabsRef,
  setActiveId,
  newTerminalInSpace,
  sidebarRef,
  sidebarMinPct,
  sidebarMaxPct,
}: Params) {
  const ranStartup = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!ready || !activeSpaceId) return;

    const { spaces, panelSizesBySpace } = useSpaces.getState();
    const meta = spaces.find((s) => s.id === activeSpaceId);

    // (1) Apply persisted panelSizes for the incoming space, if any.
    const sizes = panelSizesBySpace[activeSpaceId];
    const panel = sidebarRef.current;
    if (sizes && panel && sizes.length >= 1 && typeof sizes[0] === "number") {
      const sidebarPct = Math.min(
        sidebarMaxPct,
        Math.max(sidebarMinPct, sizes[0]),
      );
      panel.resize(`${sidebarPct}%`);
    }

    // (2) Run startup commands on first per-session activation only.
    if (!meta || ranStartup.current.has(activeSpaceId)) return;
    ranStartup.current.add(activeSpaceId);
    const cmds = meta.startupCommands;
    if (!cmds || cmds.length === 0) return;
    const root = meta.root;
    for (const cmd of cmds) {
      const tabId = newTerminalInSpace(activeSpaceId, root ?? undefined, cmd);
      submitToNewTab(
        cmd,
        () => {
          const tab = tabsRef.current.find((t) => t.id === tabId);
          return tab?.kind === "terminal" ? tab.activeLeafId : null;
        },
        () => setActiveId(tabId),
      );
    }
  }, [
    ready,
    activeSpaceId,
    tabsRef,
    setActiveId,
    newTerminalInSpace,
    sidebarRef,
    sidebarMinPct,
    sidebarMaxPct,
  ]);
}
