import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { invalidateRepoDiffs } from "@/modules/editor/lib/diffCache";

/** An agent handing the turn back is when its edits are worth re-reading. */
export function isReviewSignal(kind: unknown): boolean {
  return kind === "finished" || kind === "attention";
}

/** Whether a watch event touched the repo's working tree. The git dir is left
 * out: a status or stage writes there, and reacting to it would loop. */
export function touchesRepo(
  paths: readonly string[],
  repoRoot: string,
): boolean {
  const root = repoRoot.replace(/\/+$/, "");
  const gitDir = `${root}/.git`;
  return paths.some((raw) => {
    const p = raw.replace(/\\/g, "/");
    if (p === gitDir || p.startsWith(`${gitDir}/`)) return false;
    return p === root || p.startsWith(`${root}/`);
  });
}

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export type Coalescer = { request: () => void; dispose: () => void };

/** Debounces a burst of requests into one run, never waiting more than
 * `maxWaitMs` from the first, and folds requests that land while a run is in
 * flight into a single follow-up so the last change is always seen. */
export function createCoalescer(
  run: () => Promise<unknown> | unknown,
  { delayMs, maxWaitMs }: { delayMs: number; maxWaitMs: number },
  timers: Timers = realTimers,
): Coalescer {
  let handle: unknown = null;
  let firstAt = 0;
  let running = false;
  let pending = false;
  let disposed = false;

  const fire = () => {
    handle = null;
    if (disposed) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    void Promise.resolve()
      .then(run)
      .catch(() => {})
      .finally(() => {
        running = false;
        if (pending && !disposed) {
          pending = false;
          request();
        }
      });
  };

  const request = () => {
    if (disposed) return;
    const now = timers.now();
    if (handle === null) firstAt = now;
    else timers.clear(handle);
    const wait = Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - now));
    handle = timers.set(fire, wait);
  };

  const dispose = () => {
    disposed = true;
    if (handle !== null) timers.clear(handle);
    handle = null;
  };

  return { request, dispose };
}

type Consumer = { repoRoot: string; refresh: () => unknown };

const consumers = new Set<Consumer>();
let live: { coalescer: Coalescer; unlisten: () => void } | null = null;

function start(): { coalescer: Coalescer; unlisten: () => void } {
  const coalescer = createCoalescer(
    () => {
      const roots = new Set([...consumers].map((c) => c.repoRoot));
      for (const root of roots) invalidateRepoDiffs(root);
      return Promise.all([...consumers].map((c) => c.refresh()));
    },
    { delayMs: 400, maxWaitMs: 2000 },
  );
  let stopped = false;
  const unlisteners: (() => void)[] = [];
  const keep = (p: Promise<() => void>) => {
    void p
      .then((u) => {
        if (stopped) u();
        else unlisteners.push(u);
      })
      .catch(() => {});
  };
  keep(
    listen<{ kind?: unknown }>("terra:agent-signal", (e) => {
      if (isReviewSignal(e.payload?.kind)) coalescer.request();
    }),
  );
  // Listened to directly rather than through explorer/lib/watch, which would
  // split that module out of the eager explorer chunk into one of its own.
  keep(
    listen<{ paths?: unknown }>("fs:changed", (e) => {
      const paths = e.payload?.paths;
      if (!Array.isArray(paths)) return;
      const strings = paths.filter((p): p is string => typeof p === "string");
      for (const c of consumers) {
        if (touchesRepo(strings, c.repoRoot)) {
          coalescer.request();
          return;
        }
      }
    }),
  );
  return {
    coalescer,
    unlisten: () => {
      stopped = true;
      coalescer.dispose();
      for (const u of unlisteners.splice(0)) u();
    },
  };
}

/** Keeps the agent-signal and fs-watch subscriptions alive while at least one
 * review surface is visible; the last release tears both down. */
export function retainReviewRefresh(
  repoRoot: string,
  refresh: () => unknown,
): () => void {
  const consumer: Consumer = { repoRoot, refresh };
  consumers.add(consumer);
  live ??= start();
  return () => {
    consumers.delete(consumer);
    if (consumers.size === 0 && live) {
      live.unlisten();
      live = null;
    }
  };
}

export function reviewRefreshLive(): boolean {
  return live !== null;
}

export function useReviewAutoRefresh(
  repoRoot: string | null,
  refresh: () => unknown,
): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!repoRoot) return;
    return retainReviewRefresh(repoRoot, () => latest.current());
  }, [repoRoot]);
}
