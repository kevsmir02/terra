import { usePreferencesStore } from "@/modules/settings/preferences";
import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { BlockOverlay } from "./block/BlockOverlay";
import { BlockWatermark } from "./block/BlockWatermark";
import {
  isDragGesture,
  type Point,
  selectionToCopy,
} from "./lib/copyOnSelect";
import { writeTerminalClipboard } from "./lib/terminalClipboard";
import {
  focusLeafInput,
  submitToLeaf,
  useTerminalSession,
} from "./lib/useTerminalSession";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  /** Enable command-block decorations (OSC 133) for this terminal. */
  blocks?: boolean;
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
      blocks = false,
      onSearchReady,
      onExit,
      onCwd,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const downPtRef = useRef<Point | null>(null);
    const copyOnSelect = usePreferencesStore((s) => s.terminalCopyOnSelect);
    const { resolvedMode, themeId, customThemes } = useTheme();

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      blocks,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
    });

    const handlePaneMouseDown = useCallback((e: React.MouseEvent) => {
      downPtRef.current = { x: e.clientX, y: e.clientY };
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
          if (text) void writeTerminalClipboard(text);
        }
        return dragged;
      },
      [copyOnSelect, session],
    );

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, themeId, customThemes, session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        focus: () => session.focus(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
      }),
      [session],
    );

    const hideStyle = {
      visibility: visible ? ("visible" as const) : ("hidden" as const),
      pointerEvents: visible ? ("auto" as const) : ("none" as const),
    };

    const promptReady = session.blockMode === "prompt";

    if (blocks) {
      return (
        <div
          className="zoom-exempt flex h-full w-full flex-col"
          style={hideStyle}
        >
          <div className="relative min-h-0 flex-1">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; pointer selects command blocks */}
            <div
              ref={containerRef}
              className="absolute inset-0 z-0"
              onMouseDown={handlePaneMouseDown}
              onMouseUp={(e) => {
                // Mutually exclusive on purpose: selectBlockAt replaces the
                // selection with whole-block lines, so it must never run where
                // the copy path could observe that.
                if (!copySelectionIfDragged(e)) session.selectBlockAt(e.clientY);
                if (session.blockMode === "prompt") focusLeafInput(leafId);
              }}
            />
            <BlockWatermark
              leafId={leafId}
              subscribe={session.subscribeBlocks}
            />
            <BlockOverlay
              subscribe={session.subscribeBlocks}
              getVisible={session.visibleBlocks}
              readOutput={(id) => session.readBlockId(id)?.output ?? null}
              searchBlock={session.searchBlock}
              revealMatch={session.revealMatch}
              clearSearch={session.clearSearch}
              promptReady={promptReady}
              onRunAgain={(cmd) => submitToLeaf(leafId, cmd)}
              onRestoreFocus={() => {
                if (session.blockMode === "prompt") focusLeafInput(leafId);
              }}
            />
          </div>
        </div>
      );
    }

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
