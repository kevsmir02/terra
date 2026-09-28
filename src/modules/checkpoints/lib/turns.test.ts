import { describe, expect, it } from "vitest";
import { createPaneQueue, isTurnStart, nextTurns, type Turn } from "./turns";

describe("isTurnStart", () => {
  it("fires on launch and on each prompt only", () => {
    expect(isTurnStart("started")).toBe(true);
    expect(isTurnStart("working")).toBe(true);
    for (const k of ["attention", "finished", "exited", undefined, 1]) {
      expect(isTurnStart(k)).toBe(false);
    }
  });
});

describe("nextTurns", () => {
  const turn: Turn = { repoRoot: "/r", id: "1-2-3", at: 5 };

  it("records a ready checkpoint and keeps identity when it is reused", () => {
    const one = nextTurns(
      {},
      2,
      { kind: "ready", repoRoot: "/r", id: "1-2-3", reused: false },
      5,
    );
    expect(one).toEqual({ 2: turn });
    const again = nextTurns(
      one,
      2,
      { kind: "ready", repoRoot: "/r", id: "1-2-3", reused: true },
      9,
    );
    expect(again).toBe(one);
  });

  it("drops the old turn when the pane left the repo, was skipped or failed", () => {
    for (const outcome of [
      { kind: "not-a-repo" } as const,
      { kind: "skipped", repoRoot: "/r", reason: "too big" } as const,
      null,
    ]) {
      expect(nextTurns({ 2: turn, 3: turn }, 2, outcome, 9)).toEqual({
        3: turn,
      });
    }
  });

  it("leaves the map alone when there was nothing to drop", () => {
    const turns = { 3: turn };
    expect(nextTurns(turns, 2, { kind: "not-a-repo" }, 9)).toBe(turns);
  });
});

describe("createPaneQueue", () => {
  it("folds starts during a run into one follow-up per pane", async () => {
    const calls: number[] = [];
    const releases: (() => void)[] = [];
    const q = createPaneQueue(
      (leaf) =>
        new Promise<void>((resolve) => {
          calls.push(leaf);
          releases.push(resolve);
        }),
    );
    q.request(1);
    q.request(1);
    q.request(1);
    q.request(2);
    expect(calls).toEqual([1, 2]);
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([1, 2, 1]);
  });

  it("starts nothing after dispose", async () => {
    const calls: number[] = [];
    let release = () => {};
    const q = createPaneQueue(
      (leaf) =>
        new Promise<void>((resolve) => {
          calls.push(leaf);
          release = resolve;
        }),
    );
    q.request(1);
    q.request(1);
    q.dispose();
    release();
    await Promise.resolve();
    await Promise.resolve();
    q.request(1);
    expect(calls).toEqual([1]);
  });
});
