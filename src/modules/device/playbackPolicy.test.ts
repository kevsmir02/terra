import { describe, expect, it } from "vitest";
import { PLAYBACK_POLICY, type PlaybackState, playbackPolicy } from "./playbackPolicy";

describe("playbackPolicy", () => {
  it("takes no action when there is nothing buffered", () => {
    const state: PlaybackState = { currentTime: 0, buffered: [] };
    expect(playbackPolicy(state)).toEqual({});
  });

  it("takes no action when within both the lag and evict thresholds", () => {
    const state: PlaybackState = { currentTime: 9.5, buffered: [{ start: 0, end: 10 }] };
    expect(playbackPolicy(state)).toEqual({});
  });

  it("seeks to just behind live once the lag threshold is crossed", () => {
    const state: PlaybackState = { currentTime: 5, buffered: [{ start: 0, end: 10 }] };
    expect(playbackPolicy(state)).toEqual({ seekTo: 9.9 });
  });

  it("evicts exactly the configured window behind the playhead", () => {
    // currentTime - firstStart = 29.5 > 24, so it evicts; the surviving
    // window (currentTime - evictBefore) is exactly keepBehindSeconds (12).
    const state: PlaybackState = { currentTime: 29.5, buffered: [{ start: 0, end: 30 }] };
    const intent = playbackPolicy(state);
    expect(intent.evictBefore).toBe(17.5);
    expect(state.currentTime - (intent.evictBefore as number)).toBe(12);
    expect(intent.seekTo).toBeUndefined();
  });

  it("takes no action at stream start when the buffer barely leads the playhead", () => {
    const state: PlaybackState = { currentTime: 0, buffered: [{ start: 0, end: 0.5 }] };
    expect(playbackPolicy(state)).toEqual({});
  });

  it("seeks to just behind live at stream start once the buffer leads by more than the lag threshold", () => {
    const state: PlaybackState = { currentTime: 0, buffered: [{ start: 0, end: 3 }] };
    const intent = playbackPolicy(state);
    expect(intent).toEqual({ seekTo: 2.9 });
    expect(intent.evictBefore).toBeUndefined();
  });

  it("heals the playhead into the next range when it falls outside every buffered range", () => {
    // Gap sits between 3 and 3.9; the live edge (4) is close enough behind
    // the playhead (3.85) that this is a heal, not a live-catch-up seek.
    const state: PlaybackState = {
      currentTime: 3.85,
      buffered: [
        { start: 0, end: 3 },
        { start: 3.9, end: 4 },
      ],
    };
    expect(playbackPolicy(state)).toEqual({ seekTo: 3.9 });
  });

  it("does not heal when the playhead sits exactly on a range end", () => {
    // 5 is inclusive of the first range's end, so the playhead is inside it
    // even though a later range starts ahead of it.
    const state: PlaybackState = {
      currentTime: 5,
      buffered: [
        { start: 0, end: 5 },
        { start: 5.5, end: 6 },
      ],
    };
    expect(playbackPolicy(state)).toEqual({});
  });

  it("does not heal when the playhead sits outside every range but nothing lies ahead of it", () => {
    const state: PlaybackState = { currentTime: 10, buffered: [{ start: 0, end: 5 }] };
    // 10 is behind live by only... wait live edge is 5, currentTime is ahead of it.
    // This exercises "outside every range, no range ahead" with no lag-seek either.
    expect(playbackPolicy(state)).toEqual({});
  });

  it("combines a live-catch-up seek with an eviction in one intent", () => {
    const state: PlaybackState = { currentTime: 29, buffered: [{ start: 0, end: 40 }] };
    const intent = playbackPolicy(state);
    expect(intent.seekTo).toBe(39.9);
    expect(intent.evictBefore).toBe(17);
  });

  it("never evicts when the reclaimable window would not clear the buffer start", () => {
    // Quota-retry policy: thresholds zeroed, so eviction is only guarded by
    // evictBefore having to exceed firstStart.
    const zeroed = { ...PLAYBACK_POLICY, keepBehindSeconds: 0, evictThresholdSeconds: 0 };
    const state: PlaybackState = { currentTime: 0, buffered: [{ start: 0, end: 0 }] };
    expect(playbackPolicy(state, zeroed)).toEqual({});
  });

  it("reclaims everything up to the playhead under the quota-retry policy", () => {
    const zeroed = { ...PLAYBACK_POLICY, keepBehindSeconds: 0, evictThresholdSeconds: 0 };
    const state: PlaybackState = { currentTime: 9.5, buffered: [{ start: 0, end: 10 }] };
    expect(playbackPolicy(state, zeroed)).toEqual({ evictBefore: 9.5 });
  });

  it("never evicts at or below the buffer start even when the backlog crosses the threshold", () => {
    // Pathological policy where keepBehindSeconds exceeds evictThresholdSeconds:
    // the backlog is over threshold, but keeping that much behind the
    // playhead would land at or before the buffer's own start.
    const policy = {
      ...PLAYBACK_POLICY,
      keepBehindSeconds: 30,
      evictThresholdSeconds: 5,
    };
    const state: PlaybackState = { currentTime: 10, buffered: [{ start: 0, end: 10.5 }] };
    expect(playbackPolicy(state, policy).evictBefore).toBeUndefined();
  });
});
