import { usePreferencesStore } from "@/modules/settings/preferences";
import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
import { toast } from "sonner";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  isDragGesture,
  type Point,
  selectionToCopy,
} from "./lib/copyOnSelect";
import { writeTerminalClipboard } from "./lib/terminalClipboard";
import { useTerminalSession } from "./lib/useTerminalSession";

/** Shared so rapid selections replace one toast rather than stacking. */
const COPY_TOAST_ID = "terminal-copy-on-select";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
  /** Scroll to the previous (-1) or next (+1) prompt in the buffer. */
  scrollToCommand: (delta: 1 | -1) => boolean;
  selectLastOutput: () => boolean;
  copyLastOutput: () => boolean;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab, receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
};

export const TerminalPane = memo(
  forwardRef<TerminalPaneHandle, Props>(function TerminalPane(
    {
      leafId,
      visible,
      focused = true,
      initialCwd,
      onSearchReady,
      onExit,
      onCwd,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const downPtRef = useRef<Point | null>(null);
    const copyOnSelect = usePreferencesStore((s) => s.terminalCopyOnSelect);
    const { resolvedMode, activeTheme } = useTheme();

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
    });

    const handlePaneMouseDown = useCallback((e: React.MouseEvent) => {
      // Only a left-button press starts a selection drag. Clearing on other
      // buttons stops a right- or middle-button release from being measured
      // against a stale origin and copying.
      downPtRef.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    }, []);

    // Copies the selection when the gesture was a drag and the preference is
    // on, and reports whether it was a drag so callers can run their own
    // click-only behaviour. Clearing the origin here keeps both call sites
    // from having to remember it.
    const copySelectionIfDragged = useCallback(
      (e: React.MouseEvent): boolean => {
        const dragged = isDragGesture(downPtRef.current, {
          x: e.clientX,
          y: e.clientY,
        });
        downPtRef.current = null;
        if (dragged && copyOnSelect) {
          const text = selectionToCopy(session.getSelection() ?? "");
          if (text) {
            void writeTerminalClipboard(text).then((ok) => {
              // A stable id makes a repeat selection replace the existing
              // toast instead of stacking one per drag. Only on a confirmed
              // write, claiming success on a silently failed one is how the
              // clipboard path stayed invisible before.
              if (ok) {
                toast.success("Copied selection", { id: COPY_TOAST_ID });
              }
            });
          }
        }
        return dragged;
      },
      [copyOnSelect, session],
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run trigger: session.applyTheme reads the theme itself; these fire it on change
    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, activeTheme, session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        focus: () => session.focus(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
        scrollToCommand: (delta) => session.scrollToCommand(delta),
        selectLastOutput: () => session.selectLastOutput(),
        copyLastOutput: () => {
          const text = session.getLastOutput();
          if (!text) return false;
          void Promise.resolve(writeTerminalClipboard(text)).then(() =>
            toast.success("Copied last command output", { id: COPY_TOAST_ID }),
          );
          return true;
        },
      }),
      [session],
    );

    const hideStyle = {
      visibility: visible ? ("visible" as const) : ("hidden" as const),
      pointerEvents: visible ? ("auto" as const) : ("none" as const),
    };

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; pointer selects text for copy-on-selection
      <div
        ref={containerRef}
        className="zoom-exempt h-full w-full"
        style={hideStyle}
        onMouseDown={handlePaneMouseDown}
        onMouseUp={copySelectionIfDragged}
      />
    );
  }),
);
