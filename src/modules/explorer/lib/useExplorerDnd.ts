import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DragHit, type DropPlan, planDrop, samePlan } from "./dropPlan";

type Options = {
  rootPath: string;
  isDir: (path: string) => boolean | undefined;
  onMove: (from: string, toDir: string) => void;
  onDropToTerminal?: (leafId: number, path: string) => void;
  onTerminalHover?: (leafId: number | null) => void;
};

const THRESHOLD = 5;
const NONE: DropPlan = { kind: "none" };

function hitAt(x: number, y: number): DragHit {
  const el = document.elementFromPoint(x, y);
  const leaf = el?.closest<HTMLElement>("[data-pane-leaf]");
  const leafId = leaf ? Number(leaf.dataset.paneLeaf) : Number.NaN;
  return {
    fsPath:
      el?.closest<HTMLElement>("[data-fs-path]")?.getAttribute("data-fs-path") ??
      null,
    insideExplorer: !!el?.closest("[data-explorer-drop]"),
    paneLeafId: Number.isFinite(leafId) ? leafId : null,
  };
}

// Pointer-based, delegated on the container (no per-row handlers); sidesteps
// native HTML5 DnD which Tauri intercepts when dragDropEnabled is on. The ghost
// follows the cursor via direct DOM writes, so dragging re-renders only when the
// drop target changes, not on every move.
export function useExplorerDnd({
  rootPath,
  isDir,
  onMove,
  onDropToTerminal,
  onTerminalHover,
}: Options) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);

  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const planRef = useRef<DropPlan>(NONE);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const optsRef = useRef({
    rootPath,
    isDir,
    onMove,
    onDropToTerminal,
    onTerminalHover,
  });
  optsRef.current = { rootPath, isDir, onMove, onDropToTerminal, onTerminalHover };

  const placeGhost = useCallback((x: number, y: number) => {
    lastPosRef.current = { x, y };
    const g = ghostElRef.current;
    if (g) {
      g.style.left = `${x + 12}px`;
      g.style.top = `${y + 8}px`;
    }
  }, []);

  const ghostRef = useCallback(
    (el: HTMLDivElement | null) => {
      ghostElRef.current = el;
      if (el) placeGhost(lastPosRef.current.x, lastPosRef.current.y);
    },
    [placeGhost],
  );

  const setPlan = useCallback((plan: DropPlan) => {
    if (samePlan(planRef.current, plan)) return;
    planRef.current = plan;
    setDropTargetDir(plan.kind === "move" ? plan.toDir : null);
    optsRef.current.onTerminalHover?.(
      plan.kind === "terminal" ? plan.leafId : null,
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: placeGhost and setPlan only touch refs, so the first-render identity behaves identically
  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-fs-path]");
    const source = el?.getAttribute("data-fs-path");
    if (!source) return;
    const name = source.slice(source.lastIndexOf("/") + 1);
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        active = true;
        lastPosRef.current = { x: ev.clientX, y: ev.clientY };
        setDragLabel(name);
      }
      placeGhost(ev.clientX, ev.clientY);
      const { rootPath, isDir } = optsRef.current;
      setPlan(planDrop(hitAt(ev.clientX, ev.clientY), source, rootPath, isDir));
    };
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      cleanupRef.current = null;
    };
    const end = (commit: boolean) => {
      detach();
      if (!active) return;
      const plan = planRef.current;
      if (commit && plan.kind === "move") {
        optsRef.current.onMove(source, plan.toDir);
      } else if (commit && plan.kind === "terminal") {
        optsRef.current.onDropToTerminal?.(plan.leafId, source);
      }
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      setPlan(NONE);
      setDragLabel(null);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    cleanupRef.current = detach;
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  return { ghostRef, dragLabel, dropTargetDir, onPointerDown, onClickCapture };
}
