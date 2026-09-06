import { useCallback, useEffect, useRef } from "react";
import type { Tab } from "@/modules/tabs";
import {
  isSerializableTab,
  type ScrollbackProvider,
  serializeTabs,
} from "./serialize";
import { saveNow, saveState } from "./store";
import { useSpaces } from "./useSpaces";

const DEBOUNCE_MS = 3000;

type Snapshot = {
  tabs: Tab[];
  activeId: number;
  activeSpaceId: string;
  activeSidebarPct?: number;
};

type Params = Snapshot & {
  /** Gate writes until boot hydration finished, so restore never round-trips. */
  enabled: boolean;
  /** Latest sidebar width as a percentage of the main panel group. When defined,
   *  it is written into the active space's SpaceState.panelSizes. */
  activeSidebarPct?: number;
};

type LastWrite = {
  json: string;
  activeTabIndex: number;
  panelSizes?: number[];
};

export function useSpacePersistence({
  tabs,
  activeId,
  activeSpaceId,
  enabled,
  activeSidebarPct,
}: Params) {
  const last = useRef<Map<string, LastWrite>>(new Map());
  const seeded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After the exit flush wrote scrollback, a later plain flush must not
  // clobber it while the window tears down.
  const closing = useRef(false);
  const latest = useRef<Snapshot>({ tabs, activeId, activeSpaceId });
  latest.current = { tabs, activeId, activeSpaceId, activeSidebarPct };

  // Seed each space's last-known active index from disk so the first flush
  // preserves it for spaces the user never opens (empty json forces one write
  // with the correct index rather than clobbering it to 0).
  if (enabled && !seeded.current) {
    seeded.current = true;
    const { initialActiveIndex, panelSizesBySpace } = useSpaces.getState();
    for (const [id, idx] of Object.entries(initialActiveIndex)) {
      last.current.set(id, {
        json: "",
        activeTabIndex: idx,
        panelSizes: panelSizesBySpace[id],
      });
    }
  }

  const flush = useCallback(
    async (
      snap: Snapshot,
      activeSidebarPct?: number,
      scrollbackFor?: ScrollbackProvider,
    ): Promise<void> => {
      if (closing.current && !scrollbackFor) return;
      const writes: Promise<void>[] = [];
      const groups = new Map<string, Tab[]>();
      for (const t of snap.tabs) {
        const arr = groups.get(t.spaceId);
        if (arr) arr.push(t);
        else groups.set(t.spaceId, [t]);
      }

      const setPct = useSpaces.getState().setPanelSizes;
      for (const [spaceId, group] of groups) {
        const serialized = serializeTabs(group, scrollbackFor);
        const prev = last.current.get(spaceId);
        let activeTabIndex = prev?.activeTabIndex ?? 0;
        if (spaceId === snap.activeSpaceId) {
          const idx = group
            .filter(isSerializableTab)
            .findIndex((t) => t.id === snap.activeId);
          if (idx >= 0) activeTabIndex = idx;
        }
        const json = JSON.stringify(serialized);
        const panelSizes =
          spaceId === snap.activeSpaceId &&
          typeof activeSidebarPct === "number" &&
          Number.isFinite(activeSidebarPct)
            ? [activeSidebarPct, 100 - activeSidebarPct]
            : prev?.panelSizes;
        if (
          prev &&
          prev.json === json &&
          prev.activeTabIndex === activeTabIndex &&
          JSON.stringify(prev.panelSizes) === JSON.stringify(panelSizes)
        ) {
          continue;
        }
        last.current.set(spaceId, { json, activeTabIndex, panelSizes });
        writes.push(
          saveState(spaceId, {
            tabs: serialized,
            activeTabIndex,
            ...(panelSizes && { panelSizes }),
          }).catch(() => undefined),
        );
        if (spaceId === snap.activeSpaceId && panelSizes) {
          setPct(spaceId, panelSizes);
        }
      }
      await Promise.all(writes);
    },
    [],
  );

  // Exit path: every leaf's buffer rides along, then the store is forced to
  // disk. Plain flushes are ignored from here on.
  const flushWithScrollback = useCallback(
    async (scrollbackFor: ScrollbackProvider): Promise<void> => {
      if (!enabled) return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      await flush(
        latest.current,
        latest.current.activeSidebarPct,
        scrollbackFor,
      );
      closing.current = true;
      await saveNow();
    },
    [enabled, flush],
  );

  useEffect(() => {
    if (!enabled) return;
    const snap: Snapshot = { tabs, activeId, activeSpaceId };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush(snap, activeSidebarPct);
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tabs, activeId, activeSpaceId, activeSidebarPct, enabled, flush]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run trigger: re-arms the flush listeners so a sidebar resize is persisted
  useEffect(() => {
    if (!enabled) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden")
        void flush(latest.current, latest.current.activeSidebarPct);
    };
    const onLeave = () =>
      void flush(latest.current, latest.current.activeSidebarPct);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener<"blur">("blur", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      void flush(latest.current, latest.current.activeSidebarPct);
    };
  }, [enabled, activeSidebarPct, flush]);

  return { flushWithScrollback };
}
