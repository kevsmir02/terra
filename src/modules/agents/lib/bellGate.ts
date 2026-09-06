export const BELL_WINDOW_MS = 5000;

// One notification per leaf per window: a script that beeps in a loop must
// not flood the bell or the desktop.
export function bellAllowed(
  seen: Map<number, number>,
  leafId: number,
  now: number,
): boolean {
  const last = seen.get(leafId);
  if (last !== undefined && now - last < BELL_WINDOW_MS) return false;
  seen.set(leafId, now);
  return true;
}
