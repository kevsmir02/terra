import { lazy, Suspense } from "react";
import type { BroadcastSessions } from "./BroadcastInput";
import { useAgentActivityStore } from "./lib/agentActivity";
import { broadcastCandidate, typeLineIntoLeaf } from "./lib/useTerminalSession";

const BroadcastInputInner = lazy(() =>
  import("./BroadcastInput").then((m) => ({ default: m.BroadcastInput })),
);

const sessions: BroadcastSessions = {
  probe: broadcastCandidate,
  typeLine: typeLineIntoLeaf,
  subscribeAgents: (onChange) => useAgentActivityStore.subscribe(onChange),
  agentsSnapshot: () => useAgentActivityStore.getState().phases,
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leafIds: readonly number[];
};

/**
 * Callers gate the mount on first open (App latches it), so the dialog chunk
 * is fetched then rather than at startup; once mounted it stays mounted to
 * keep the exit animation, and its form, with the agent subscription, only
 * renders while open.
 */
export function BroadcastInput(props: Props) {
  return (
    <Suspense fallback={null}>
      <BroadcastInputInner {...props} sessions={sessions} />
    </Suspense>
  );
}
