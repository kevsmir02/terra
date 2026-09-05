// Ported from ws-scrcpy's MsePlayer pattern (Apache-2.0). The MediaSource
// SourceBuffer is fed fMP4 init segment (kind=0) and moof+mdat fragments
// (kind=1) emitted from the Rust read loop. We do not parse NALs here, Rust
// already did. We append bytes to the SourceBuffer when it can accept more.

import {
  type BufferedRange,
  PLAYBACK_POLICY,
  type PlaybackPolicy,
  playbackPolicy,
} from "./playbackPolicy";

export type MseErrorHandler = (message: string) => void;

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: unknown; code?: unknown } | null;
  return !!err && (err.name === "QuotaExceededError" || err.code === 22);
}

function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export class MsePlayer {
  private mediaSource: MediaSource;
  private sourceBuffer: SourceBuffer | null = null;
  private pending: Uint8Array<ArrayBuffer>[] = [];
  private codecString: string | null = null;
  private ended = false;
  private trimPending = false;
  private quotaRetryArmed = false;
  private warnedPlayheadDrift = false;
  private readonly onError: MseErrorHandler | undefined;
  readonly video: HTMLVideoElement;

  constructor(video: HTMLVideoElement, onError?: MseErrorHandler) {
    this.video = video;
    this.onError = onError;
    this.mediaSource = new MediaSource();
    video.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener("sourceopen", this.onSourceOpen);
    this.mediaSource.addEventListener("sourceclose", this.onSourceClose);
    video.addEventListener("error", this.onVideoError);
  }

  private onSourceOpen = () => {
    if (this.codecString && !this.sourceBuffer) {
      this.initSourceBuffer();
    }
  };

  // A browser-side close with nothing queued would otherwise leave the
  // player looking alive (no pending append to fail) until the next frame.
  private onSourceClose = () => this.fail("MediaSource closed unexpectedly");

  private onVideoError = () => {
    const code = this.video.error?.code;
    this.fail(`Video element error${code === undefined ? "" : ` (code ${code})`}`);
  };

  private initSourceBuffer() {
    if (this.ended || !this.codecString || this.sourceBuffer) return;
    const mimeType = this.codecString.startsWith("video/")
      ? this.codecString
      : `video/mp4; codecs="${this.codecString}"`;
    try {
      this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
      this.sourceBuffer.addEventListener("updateend", this.onUpdateEnd);
      this.flushPending();
    } catch (e) {
      this.fail(`Cannot decode ${mimeType} (${describeError(e)})`);
    }
  }

  private onUpdateEnd = () => this.flushPending();

  /** kind: 0 = init segment (carries the codec string in-band),
   *        1 = media fragment bytes. `payload` is a view, never copied. */
  pushData(kind: number, payload: Uint8Array<ArrayBuffer>) {
    if (this.ended) return;
    if (kind === 0) {
      // CONTRACT (Rust↔TS codec-string handoff, see remux.rs Fmp4Builder):
      // The init segment payload (kind=0) from the Rust read loop is laid out as:
      //   [4-byte BE length] [UTF-8 codec string, e.g. "avc1.42001E"] [fMP4 ftyp+moov bytes]
      // We extract the codec string here for SourceBuffer construction and feed
      // the remainder to SourceBuffer.
      if (payload.byteLength < 4) {
        this.fail("Init segment is too short to carry a codec length; stream is unusable");
        return;
      }
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const len = view.getUint32(0, /* littleEndian */ false);
      this.codecString = new TextDecoder().decode(payload.subarray(4, 4 + len));
      this.pending.push(payload.subarray(4 + len));
      if (!this.sourceBuffer && this.mediaSource.readyState === "open") {
        this.initSourceBuffer();
      }
    } else {
      this.pending.push(payload);
    }
    this.flushPending();
  }

  private flushPending() {
    const sb = this.sourceBuffer;
    if (this.ended || !sb || sb.updating) return;
    const next = this.pending[0];
    if (next === undefined) return;
    // A seek never blocks the append; only an evict does (it waits on
    // updateend), so only an issued evict returns early here.
    if (this.applyPolicy(sb, PLAYBACK_POLICY)) return;
    try {
      sb.appendBuffer(next);
      this.pending.shift();
      this.trimPending = false;
      this.quotaRetryArmed = false;
      if (this.video.paused) {
        void this.video.play().catch(() => {});
      }
    } catch (e) {
      if (!isQuotaError(e)) {
        this.fail(`Video append failed (${describeError(e)})`);
        return;
      }
      // The fragment stays at the head of the queue; updateend after the
      // evict re-enters flushPending and retries it exactly once.
      if (!this.quotaRetryArmed) {
        this.quotaRetryArmed = true;
        if (this.applyPolicy(sb, { ...PLAYBACK_POLICY, keepBehindSeconds: 0, evictThresholdSeconds: 0 })) {
          return;
        }
      }
      this.fail("Video buffer is full and nothing behind the playhead could be reclaimed");
    }
  }

  private bufferedRanges(sb: SourceBuffer): BufferedRange[] {
    try {
      const buffered = sb.buffered;
      const ranges: BufferedRange[] = [];
      for (let i = 0; i < buffered.length; i++) {
        ranges.push({ start: buffered.start(i), end: buffered.end(i) });
      }
      return ranges;
    } catch {
      return [];
    }
  }

  // Returns true when an evict (remove) was issued; appending resumes on
  // updateend. A seek is applied unconditionally and does not gate the return.
  private applyPolicy(sb: SourceBuffer, policy: PlaybackPolicy): boolean {
    const currentTime = this.video.currentTime;
    const buffered = this.bufferedRanges(sb);
    const intent = playbackPolicy({ currentTime, buffered }, policy);

    if (intent.seekTo !== undefined) {
      this.video.currentTime = intent.seekTo;
      // Only warn for the rare case where the playhead was orphaned outside
      // every buffered range: a live-catch-up seek from within a continuous
      // range is routine (e.g. every stream start) and not worth logging.
      const outsideEveryRange = buffered.length > 0 && !buffered.some((r) => currentTime >= r.start && currentTime <= r.end);
      if (outsideEveryRange && !this.warnedPlayheadDrift) {
        this.warnedPlayheadDrift = true;
        console.warn("[device] MSE: playhead fell outside the buffered ranges, seeking to", intent.seekTo);
      }
    }

    if (intent.evictBefore === undefined || this.trimPending) return false;
    try {
      sb.remove(0, intent.evictBefore);
      this.trimPending = true;
      return true;
    } catch (e) {
      console.warn("[device] MSE: remove failed:", e);
      return false;
    }
  }

  private fail(message: string) {
    if (this.ended) return;
    this.ended = true;
    this.pending = [];
    this.mediaSource.removeEventListener("sourceclose", this.onSourceClose);
    this.video.removeEventListener("error", this.onVideoError);
    this.sourceBuffer?.removeEventListener("updateend", this.onUpdateEnd);
    console.error("[device] MSE:", message);
    this.onError?.(message);
  }

  dispose() {
    this.ended = true;
    this.pending = [];
    this.mediaSource.removeEventListener("sourceopen", this.onSourceOpen);
    this.mediaSource.removeEventListener("sourceclose", this.onSourceClose);
    this.video.removeEventListener("error", this.onVideoError);
    this.sourceBuffer?.removeEventListener("updateend", this.onUpdateEnd);
    if (this.mediaSource.readyState === "open") {
      try { this.mediaSource.endOfStream(); } catch {}
    }
    URL.revokeObjectURL(this.video.src);
    this.sourceBuffer = null;
  }
}
