export const IDLE_SHUTDOWN_MS = 3 * 60 * 1000;
export const CRASH_WINDOW_MS = 5 * 60 * 1000;
export const MAX_CRASHES = 3;
export const MAX_SESSIONS_PER_PRESET = 4;
export const CRASH_COOLDOWN_MS = [2_000, 10_000, 30_000] as const;
export const EVICTION_MIN_AGE_MS = 10_000;

export type SessionView = {
  key: string;
  presetId: string;
  openDocs: number;
  closing: boolean;
  bornAt: number;
};

export function sessionKey(presetId: string, root: string): string {
  return `${presetId}\u0000${root}`;
}

export function isPresetKey(key: string, presetId: string): boolean {
  return key.startsWith(`${presetId}\u0000`);
}

export function recentCrashes(times: readonly number[], now: number): number[] {
  return times.filter((t) => now - t < CRASH_WINDOW_MS);
}

export function isCrashedOut(times: readonly number[], now: number): boolean {
  return recentCrashes(times, now).length >= MAX_CRASHES;
}

/** A budget kill gives up at once: respawning would repay the peak that killed it. */
export function givenUpCrashes(now: number): number[] {
  return Array.from({ length: MAX_CRASHES }, () => now);
}

export function crashCooldownMs(recentCrashCount: number): number {
  const i = Math.min(
    Math.max(recentCrashCount, 1) - 1,
    CRASH_COOLDOWN_MS.length - 1,
  );
  return CRASH_COOLDOWN_MS[i];
}

/**
 * Idle sessions of the same server on other roots, old enough that a burst of
 * multi-root opens cannot evict a sibling that was born a moment ago.
 */
export function evictableSessions(
  sessions: readonly SessionView[],
  presetId: string,
  key: string,
  now: number,
): string[] {
  if (sessions.some((s) => s.key === key)) return [];
  return sessions
    .filter(
      (s) =>
        s.presetId === presetId &&
        s.openDocs === 0 &&
        !s.closing &&
        now - s.bornAt > EVICTION_MIN_AGE_MS,
    )
    .map((s) => s.key);
}

/** Counted after eviction: the cap bounds live servers, not idle leftovers. */
export function admitSession(
  sessions: readonly SessionView[],
  presetId: string,
  key: string,
): "reuse" | "create" | "refuse" {
  if (sessions.some((s) => s.key === key)) return "reuse";
  const live = sessions.filter((s) => s.presetId === presetId).length;
  return live >= MAX_SESSIONS_PER_PRESET ? "refuse" : "create";
}
