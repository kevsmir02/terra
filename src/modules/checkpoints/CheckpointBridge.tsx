import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect, useRef } from "react";

type Props = {
  cwdForLeaf: (leafId: number) => string | undefined;
  leafIdForPty: (ptyId: number) => number | null;
};

/** Turns checkpoints on while the setting is. Disabled, it holds no listener
 * and the listener module is never fetched. */
export function CheckpointBridge({ cwdForLeaf, leafIdForPty }: Props) {
  const enabled = usePreferencesStore((s) => s.agentCheckpoints);
  const cwdRef = useRef(cwdForLeaf);
  const ptyRef = useRef(leafIdForPty);
  ptyRef.current = leafIdForPty;
  cwdRef.current = cwdForLeaf;

  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | null = null;
    let alive = true;
    void import("./lib/listener").then((m) => {
      if (alive)
        stop = m.startCheckpoints(
          (leaf) => cwdRef.current(leaf),
          (pty) => ptyRef.current(pty),
        );
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [enabled]);

  return null;
}
