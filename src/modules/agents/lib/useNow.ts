import { useEffect, useState } from "react";

/** Wall clock that re-renders every `intervalMs` while the caller is mounted,
 * and not at all otherwise: the only timer the agent surfaces own. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
