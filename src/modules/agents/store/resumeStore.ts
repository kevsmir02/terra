import { create } from "zustand";
import { isResumableAgent, type ResumableAgent } from "../lib/resume";
import { useAgentStore } from "./agentStore";

type ResumeState = {
  /** leaf id -> the agent it ran before the last close, until acted on. */
  offers: Record<number, ResumableAgent>;
  offer: (leafId: number, agent: ResumableAgent) => void;
  dismiss: (leafId: number) => void;
};

export const useResumeStore = create<ResumeState>((set) => ({
  offers: {},
  offer: (leafId, agent) =>
    set((s) => ({ offers: { ...s.offers, [leafId]: agent } })),
  dismiss: (leafId) =>
    set((s) => {
      if (!(leafId in s.offers)) return s;
      const offers = { ...s.offers };
      delete offers[leafId];
      return { offers };
    }),
}));

/** Restore sink: records an offer for a leaf the hydrated tree allocated. */
export function offerResume(leafId: number, agent: ResumableAgent): void {
  useResumeStore.getState().offer(leafId, agent);
}

export function hasResumeOffer(leafId: number): boolean {
  return leafId in useResumeStore.getState().offers;
}

/**
 * The agent to persist for a leaf on a decided close: the one running now, or
 * one still on offer from the previous launch, so ignoring the offer for a
 * session does not lose it. Null for anything that cannot be resumed.
 */
export function persistedAgent(leafId: number): ResumableAgent | null {
  const live = useAgentStore.getState().sessions[leafId]?.agent;
  if (isResumableAgent(live)) return live;
  return useResumeStore.getState().offers[leafId] ?? null;
}
