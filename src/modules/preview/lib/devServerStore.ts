import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

type DevServerSignal = { id: number; url: string };

export type DevServerEntry = {
  /** URL currently offered by the chip, or null when nothing is offered. */
  candidate: string | null;
  /** Last URL the user dismissed. Sticky for the life of the PTY session. */
  dismissed: string | null;
};

/** Next entry state for a detection, or null when nothing should change.
 * Pure so the policy stays unit-testable without React or Tauri. */
export function nextEntry(
  entry: DevServerEntry | undefined,
  url: string,
): DevServerEntry | null {
  const dismissed = entry?.dismissed ?? null;
  // The user already answered for this URL; re-asking is the nagging the chip
  // exists to avoid. A different URL always prompts.
  if (url === dismissed) return null;
  if (entry?.candidate === url) return null;
  return { candidate: url, dismissed };
}

/** `host:port` for chip display. The path is dropped: it would widen the chip
 * without helping the user decide. */
export function chipLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type DevServerStore = {
  byLeaf: Record<number, DevServerEntry>;
  detect: (leafId: number, url: string) => void;
  dismiss: (leafId: number) => void;
  clear: (leafId: number) => void;
};

export const useDevServerStore = create<DevServerStore>((set) => ({
  byLeaf: {},
  detect: (leafId, url) =>
    set((s) => {
      const next = nextEntry(s.byLeaf[leafId], url);
      if (next === null) return s;
      return { byLeaf: { ...s.byLeaf, [leafId]: next } };
    }),
  dismiss: (leafId) =>
    set((s) => {
      const entry = s.byLeaf[leafId];
      if (!entry?.candidate) return s;
      return {
        byLeaf: {
          ...s.byLeaf,
          [leafId]: { candidate: null, dismissed: entry.candidate },
        },
      };
    }),
  clear: (leafId) =>
    set((s) => {
      if (!(leafId in s.byLeaf)) return s;
      const byLeaf = { ...s.byLeaf };
      delete byLeaf[leafId];
      return { byLeaf };
    }),
}));

let opener: ((url: string) => void) | null = null;
let bound = false;

/** Registered by App, which owns tab creation. */
export function setDevServerOpener(open: (url: string) => void): void {
  opener = open;
}

/** Opens the candidate for a leaf and clears the offer. */
export function openDevServer(leafId: number): void {
  const store = useDevServerStore.getState();
  const url = store.byLeaf[leafId]?.candidate;
  if (!url) return;
  store.dismiss(leafId);
  opener?.(url);
}

// The Rust detector reports per-pty; the chip renders per pane, so resolve
// pty -> leaf on arrival. `resolveLeaf` is injected rather than imported to
// keep this module free of a dependency on useTerminalSession.
export function ensureDevServerListener(
  resolveLeaf: (ptyId: number) => number | null,
): void {
  if (bound || typeof window === "undefined") return;
  bound = true;
  void listen<DevServerSignal>("terra:dev-server", (e) => {
    const leafId = resolveLeaf(e.payload.id);
    if (leafId === null) return;
    useDevServerStore.getState().detect(leafId, e.payload.url);
  });
}
