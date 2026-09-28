import { afterEach, describe, expect, it, vi } from "vitest";

const listen = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...args),
}));
vi.mock("@/lib/native", () => ({ native: {} }));

const {
  createCoalescer,
  isReviewSignal,
  retainReviewRefresh,
  reviewRefreshLive,
  touchesRepo,
} = await import("./reviewRefresh");

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      seq += 1;
      pending.set(seq, { at: now + ms, fn });
      return seq;
    },
    clear: (h: unknown) => {
      pending.delete(h as number);
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("isReviewSignal", () => {
  it("fires only when an agent hands the turn back", () => {
    expect(isReviewSignal("finished")).toBe(true);
    expect(isReviewSignal("attention")).toBe(true);
    for (const kind of ["started", "working", "exited", "", undefined, 1]) {
      expect(isReviewSignal(kind)).toBe(false);
    }
  });
});

describe("touchesRepo", () => {
  it("matches paths inside the working tree", () => {
    expect(touchesRepo(["/repo/src/a.ts"], "/repo")).toBe(true);
    expect(touchesRepo(["/repo"], "/repo/")).toBe(true);
  });

  it("ignores a sibling that only shares the prefix", () => {
    expect(touchesRepo(["/repo2/a.ts", "/rep"], "/repo")).toBe(false);
  });

  it("ignores the git dir so a status or stage cannot trigger itself", () => {
    expect(touchesRepo(["/repo/.git", "/repo/.git/index"], "/repo")).toBe(
      false,
    );
    expect(touchesRepo(["/repo/.github/ci.yml"], "/repo")).toBe(true);
  });
});

describe("createCoalescer", () => {
  it("runs once for a burst, after the quiet period", async () => {
    const t = fakeTimers();
    const run = vi.fn();
    const c = createCoalescer(run, { delayMs: 100, maxWaitMs: 1000 }, t);
    c.request();
    t.advance(50);
    c.request();
    t.advance(50);
    c.request();
    t.advance(99);
    await flush();
    expect(run).not.toHaveBeenCalled();
    t.advance(1);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never waits past maxWait under a steady stream", async () => {
    const t = fakeTimers();
    const run = vi.fn();
    const c = createCoalescer(run, { delayMs: 100, maxWaitMs: 250 }, t);
    for (let i = 0; i < 5; i++) {
      c.request();
      t.advance(60);
    }
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("folds requests made during a run into exactly one follow-up", async () => {
    const t = fakeTimers();
    let release!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const c = createCoalescer(run, { delayMs: 10, maxWaitMs: 100 }, t);
    c.request();
    t.advance(10);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      c.request();
      t.advance(10);
    }
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await flush();
    t.advance(10);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does nothing after dispose", async () => {
    const t = fakeTimers();
    const run = vi.fn();
    const c = createCoalescer(run, { delayMs: 10, maxWaitMs: 100 }, t);
    c.request();
    c.dispose();
    c.request();
    t.advance(100);
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("retainReviewRefresh", () => {
  afterEach(() => {
    listen.mockReset();
  });

  it("subscribes nothing until a surface retains it and tears down on the last release", async () => {
    const unlistenSignal = vi.fn();
    const unlistenFs = vi.fn();
    listen.mockImplementation((event: string) =>
      Promise.resolve(event === "fs:changed" ? unlistenFs : unlistenSignal),
    );

    expect(reviewRefreshLive()).toBe(false);
    expect(listen).not.toHaveBeenCalled();

    const releaseA = retainReviewRefresh("/repo", () => {});
    const releaseB = retainReviewRefresh("/repo", () => {});
    expect(listen.mock.calls.map((c) => c[0]).sort()).toEqual([
      "fs:changed",
      "terra:agent-signal",
    ]);
    await flush();

    releaseA();
    expect(reviewRefreshLive()).toBe(true);
    expect(unlistenSignal).not.toHaveBeenCalled();

    releaseB();
    expect(reviewRefreshLive()).toBe(false);
    expect(unlistenSignal).toHaveBeenCalledTimes(1);
    expect(unlistenFs).toHaveBeenCalledTimes(1);
  });

  it("drops a subscription that resolves after the release", async () => {
    const unlisten = vi.fn();
    let resolveListen!: (u: () => void) => void;
    listen.mockImplementation((event: string) =>
      event === "fs:changed"
        ? Promise.resolve(vi.fn())
        : new Promise((r) => {
            resolveListen = r;
          }),
    );
    const release = retainReviewRefresh("/repo", () => {});
    release();
    resolveListen(unlisten);
    await flush();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("the live subscription", () => {
  afterEach(() => {
    listen.mockReset();
  });

  it("refreshes on a finished signal or a working-tree change, never on the git dir", async () => {
    vi.useFakeTimers();
    try {
      const handlers = new Map<string, (e: { payload: unknown }) => void>();
      listen.mockImplementation(
        (event: string, handler: (e: { payload: unknown }) => void) => {
          handlers.set(event, handler);
          return Promise.resolve(vi.fn());
        },
      );
      const refresh = vi.fn();
      const release = retainReviewRefresh("/repo", refresh);
      const signal = handlers.get("terra:agent-signal");
      const fs = handlers.get("fs:changed");

      signal?.({ payload: { kind: "working" } });
      fs?.({ payload: { paths: ["/repo/.git/index", "/other/a"] } });
      fs?.({ payload: { paths: "not-an-array" } });
      await vi.advanceTimersByTimeAsync(3000);
      expect(refresh).not.toHaveBeenCalled();

      signal?.({ payload: { kind: "finished" } });
      fs?.({ payload: { paths: ["/repo/src/a.ts"] } });
      await vi.advanceTimersByTimeAsync(3000);
      expect(refresh).toHaveBeenCalledTimes(1);
      release();
    } finally {
      vi.useRealTimers();
    }
  });
});
