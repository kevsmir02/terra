import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { SearchAddon } from "@xterm/addon-search";
import { Fragment } from "react";
import { DevServerChip } from "@/modules/preview/DevServerChip";
import { cn } from "@/lib/utils";
import { useAgentActivityStore } from "./lib/agentActivity";
import { useTerminalDropStore } from "./lib/dropStore";
import { ptyIdForLeaf } from "./lib/useTerminalSession";
import { firstLeafSlotId, type PaneNode } from "./lib/panes";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  /** True once the tab holds more than one leaf, when "which pane takes the
   * next keystroke" stops being obvious and has to be drawn. */
  split: boolean;
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
};

export function PaneTreeView(props: Props) {
  const { node } = props;
  if (node.kind === "leaf") {
    const { tabVisible, activeLeafId, split, onFocusLeaf, getBundle } = props;
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: focus tracking for a pane wrapper, not a control
      <div
        onMouseDownCapture={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        // Catches focus from Tab, programmatic focus, or any path that
        // skips mousedown, keeps activeLeafId in sync with DOM focus.
        onFocus={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        data-pane-leaf={node.id}
        className="relative h-full w-full"
      >
        <TerminalPane
          leafId={node.id}
          visible={tabVisible}
          focused={focused}
          initialCwd={node.cwd}
          ref={b.setRef}
          onSearchReady={b.onSearchReady}
          onCwd={b.onCwd}
          onExit={b.onExit}
        />
        {split ? <PaneFocusRing focused={focused} /> : null}
        <PaneAttentionEdge leafId={node.id} />
        <DropOverlay leafId={node.id} />
        <DevServerChip leafId={node.id} />
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => {
        const slotId = firstLeafSlotId(child);
        return (
          <Fragment key={slotId}>
            {i > 0 && <ResizableHandle />}
            <ResizablePanel id={`pane-slot-${slotId}`} minSize="10%">
              <PaneTreeView {...props} node={child} />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}

/** Dims the unfocused pane's edge, never its output: the other agent has to
 * stay readable while you type into this one. */
function PaneFocusRing({ focused }: { focused: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 ring-1 ring-inset transition-colors terra-motion",
        focused ? "ring-ring/(--emph-bold)" : "ring-border/(--emph-medium)",
      )}
    />
  );
}

function PaneAttentionEdge({ leafId }: { leafId: number }) {
  // Selects the whole phase map on purpose: ptyIdForLeaf reads a non-reactive
  // session map, so the id is only trustworthy on a render an agent signal
  // caused. The component renders nothing in every other phase.
  const phases = useAgentActivityStore((s) => s.phases);
  const ptyId = ptyIdForLeaf(leafId);
  if (ptyId === null || phases[ptyId] !== "attention") return null;
  return (
    <span
      aria-hidden
      className="terra-fade-in pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-status-warning"
    />
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="terra-fade-in pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/(--emph-soft) bg-background/(--emph-strong) text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
  );
}
