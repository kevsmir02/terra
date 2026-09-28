import { create } from "zustand";
import { type CheckpointOutcome, nextTurns, type Turn } from "./lib/turns";

type TurnState = {
  /** leaf id -> the checkpoint its current turn started from. */
  turns: Record<number, Turn>;
  record: (leafId: number, outcome: CheckpointOutcome | null) => void;
  clear: () => void;
};

export const useTurnStore = create<TurnState>((set) => ({
  turns: {},
  record: (leafId, outcome) =>
    set((s) => {
      const turns = nextTurns(s.turns, leafId, outcome, Date.now());
      return turns === s.turns ? s : { turns };
    }),
  clear: () => set((s) => (Object.keys(s.turns).length ? { turns: {} } : s)),
}));

/** Read without subscribing, for callers that only look when asked. */
export function turnFor(leafId: number | null): Turn | null {
  if (leafId === null) return null;
  return useTurnStore.getState().turns[leafId] ?? null;
}
