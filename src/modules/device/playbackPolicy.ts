// Pure policy for keeping the MSE buffer bounded and the playhead near live.
// No DOM, no SourceBuffer, no Date: MsePlayer.ts translates TimeRanges into
// BufferedRange[] and video.currentTime into PlaybackState, then applies the
// returned intent.

export type BufferedRange = { start: number; end: number };

export type PlaybackState = {
  currentTime: number;
  buffered: BufferedRange[];
};

export type PlaybackIntent = {
  seekTo?: number;
  // Which rule produced seekTo, so the caller can tell a routine live
  // catch-up from an anomalous heal without re-deriving the rule itself.
  seekReason?: "live" | "heal";
  evictBefore?: number;
};

export type PlaybackPolicy = {
  // One scrcpy GOP (10 s) plus margin, because remove() extends to the next keyframe.
  keepBehindSeconds: number;
  // Trim only when the backlog is worth a remove().
  evictThresholdSeconds: number;
  // Further behind the live edge than this is a stall, not latency.
  liveLagThresholdSeconds: number;
  // Land just behind live, never on the edge.
  liveTargetOffsetSeconds: number;
};

export const PLAYBACK_POLICY: PlaybackPolicy = {
  keepBehindSeconds: 12,
  evictThresholdSeconds: 24,
  liveLagThresholdSeconds: 1,
  liveTargetOffsetSeconds: 0.1,
};

export function playbackPolicy(
  state: PlaybackState,
  policy: PlaybackPolicy = PLAYBACK_POLICY,
): PlaybackIntent {
  const { currentTime, buffered } = state;
  if (buffered.length === 0) return {};

  const lastRange = buffered[buffered.length - 1];
  const liveEdge = lastRange.end;
  let seekTo: number | undefined;
  let seekReason: "live" | "heal" | undefined;

  if (liveEdge - currentTime > policy.liveLagThresholdSeconds) {
    // Behind by more than the lag threshold is a stall: rejoin near live
    // instead of playing out the backlog in real time.
    seekTo = Math.max(liveEdge - policy.liveTargetOffsetSeconds, lastRange.start);
    seekReason = "live";
  } else {
    const insideAny = buffered.some((r) => currentTime >= r.start && currentTime <= r.end);
    if (!insideAny) {
      let nextStart: number | undefined;
      for (const r of buffered) {
        if (r.start > currentTime && (nextStart === undefined || r.start < nextStart)) {
          nextStart = r.start;
        }
      }
      if (nextStart !== undefined) {
        seekTo = nextStart;
        seekReason = "heal";
      }
    }
  }

  const firstStart = buffered[0].start;
  let evictBefore: number | undefined;
  if (currentTime - firstStart > policy.evictThresholdSeconds) {
    const candidate = currentTime - policy.keepBehindSeconds;
    if (candidate > firstStart) evictBefore = candidate;
  }

  const intent: PlaybackIntent = {};
  if (seekTo !== undefined) {
    intent.seekTo = seekTo;
    intent.seekReason = seekReason;
  }
  if (evictBefore !== undefined) intent.evictBefore = evictBefore;
  return intent;
}
