import { describe, expect, it } from "vitest";
import {
  admitSession,
  CRASH_WINDOW_MS,
  crashCooldownMs,
  EVICTION_MIN_AGE_MS,
  evictableSessions,
  givenUpCrashes,
  isCrashedOut,
  isPresetKey,
  MAX_SESSIONS_PER_PRESET,
  type SessionView,
  sessionKey,
} from "./sessionPolicy";

const NOW = 1_000_000_000;

function view(
  presetId: string,
  root: string,
  over: Partial<SessionView> = {},
): SessionView {
  return {
    key: sessionKey(presetId, root),
    presetId,
    openDocs: 1,
    closing: false,
    bornAt: NOW - 60_000,
    ...over,
  };
}

describe("session key", () => {
  it("does not let one server claim another's keys by prefix", () => {
    expect(isPresetKey(sessionKey("ruff", "/a"), "ruff")).toBe(true);
    expect(isPresetKey(sessionKey("ruff-lsp", "/a"), "ruff")).toBe(false);
  });
});

describe("session cap", () => {
  const full = [1, 2, 3, 4].map((i) => view("rust", `/p${i}`));

  it("refuses a fifth root once the server holds the cap", () => {
    expect(full).toHaveLength(MAX_SESSIONS_PER_PRESET);
    expect(admitSession(full, "rust", sessionKey("rust", "/p5"))).toBe(
      "refuse",
    );
  });

  it("still reuses a root it already serves at the cap", () => {
    expect(admitSession(full, "rust", sessionKey("rust", "/p1"))).toBe("reuse");
  });

  it("counts each server on its own", () => {
    expect(admitSession(full, "gopls", sessionKey("gopls", "/p1"))).toBe(
      "create",
    );
  });
});

describe("eviction", () => {
  it("evicts only idle, settled sessions of the same server", () => {
    const sessions = [
      view("rust", "/idle", { openDocs: 0 }),
      view("rust", "/busy"),
      view("rust", "/closing", { openDocs: 0, closing: true }),
      view("rust", "/newborn", {
        openDocs: 0,
        bornAt: NOW - EVICTION_MIN_AGE_MS,
      }),
      view("gopls", "/idle", { openDocs: 0 }),
    ];
    expect(
      evictableSessions(sessions, "rust", sessionKey("rust", "/new"), NOW),
    ).toEqual([sessionKey("rust", "/idle")]);
  });

  it("evicts nothing when the root is already served", () => {
    const sessions = [
      view("rust", "/a", { openDocs: 0 }),
      view("rust", "/b", { openDocs: 0 }),
    ];
    expect(
      evictableSessions(sessions, "rust", sessionKey("rust", "/a"), NOW),
    ).toEqual([]);
  });
});

describe("crash backoff", () => {
  it("gives up at the third crash inside the window", () => {
    expect(isCrashedOut([NOW - 2, NOW - 1], NOW)).toBe(false);
    expect(isCrashedOut([NOW - 3, NOW - 2, NOW - 1], NOW)).toBe(true);
  });

  it("forgets a crash exactly one window old", () => {
    expect(isCrashedOut([NOW - CRASH_WINDOW_MS, NOW - 2, NOW - 1], NOW)).toBe(
      false,
    );
    expect(
      isCrashedOut([NOW - CRASH_WINDOW_MS + 1, NOW - 2, NOW - 1], NOW),
    ).toBe(true);
  });

  it("a budget kill is crashed out immediately", () => {
    expect(isCrashedOut(givenUpCrashes(NOW), NOW)).toBe(true);
  });

  it("backs off longer with each crash and clamps at the last step", () => {
    expect([0, 1, 2, 3, 9].map(crashCooldownMs)).toEqual([
      2_000, 2_000, 10_000, 30_000, 30_000,
    ]);
  });
});
