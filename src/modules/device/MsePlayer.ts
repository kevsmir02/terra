// Ported from ws-scrcpy's MsePlayer pattern (Apache-2.0). The MediaSource
// SourceBuffer is fed fMP4 init segment (kind=0) and moof+mdat fragments
// (kind=1) emitted from the Rust read loop. We do not parse NALs here — Rust
// already did. We append bytes to the SourceBuffer when it can accept more.

// A remove(start, end) is extended by the browser to the next keyframe at or
// after `end`, and scrcpy's default keyframe interval is 10 s, so keeping less
// than one GOP behind the playhead would evict the GOP currently on screen.
export const TRIM_KEEP_SECONDS = 12;
export const TRIM_THRESHOLD_SECONDS = TRIM_KEEP_SECONDS * 2;

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
  private pending: ArrayBuffer[] = [];
  private codecString: string | null = null;
  private appendCount = 0;
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
    console.info("[device] MSE: sourceopen, readyState=", this.mediaSource.readyState);
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
      console.info("[device] MSE: addSourceBuffer", mimeType);
      this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
      // ponytail: "sequence" (default) is more tolerant than "segments" — Chrome
      // doesn't require styp/sidx boxes between our per-NAL moof+mdat fragments.
      // Switch to "segments" only when we batch full access units + add styp.
      this.sourceBuffer.addEventListener("updateend", this.onUpdateEnd);
      this.flushPending();
    } catch (e) {
      this.fail(`Cannot decode ${mimeType} (${describeError(e)})`);
    }
  }

  private onUpdateEnd = () => {
    const afterTrim = this.trimPending;
    if (afterTrim) this.healPlayheadAfterTrim();
    this.flushPending();
  };

  /** kind: 0 = init segment (carries the codec string in-band),
   *        1 = media fragment bytes. */
  pushData(kind: number, bytes: ArrayBuffer) {
    if (this.ended) return;
    if (kind === 0) {
      // CONTRACT (Rust↔TS codec-string handoff, see remux.rs Fmp4Builder):
      // The init segment frame (kind=0) from the Rust read loop is laid out as:
      //   [4-byte BE length] [UTF-8 codec string, e.g. "avc1.42001E"] [fMP4 ftyp+moov bytes]
      // We extract the codec string here for SourceBuffer construction and feed
      // the remainder to SourceBuffer.
      const view = new DataView(bytes);
      const len = view.getUint32(0, /* littleEndian */ false);
      this.codecString = new TextDecoder().decode(
        new Uint8Array(bytes, 4, len),
      );
      const remainder = bytes.slice(4 + len);
      console.info(
        "[device] MSE: recv INIT kind=0 codec=", this.codecString,
        "frameLen=", bytes.byteLength, "moovLen=", remainder.byteLength,
      );
      this.pending.push(remainder);
      if (!this.sourceBuffer && this.mediaSource.readyState === "open") {
        this.initSourceBuffer();
      }
    } else {
      this.pending.push(bytes);
    }
    this.flushPending();
  }

  private flushPending() {
    const sb = this.sourceBuffer;
    if (this.ended || !sb || sb.updating) return;
    const next = this.pending[0];
    if (next === undefined) return;
    // At most one trim per append, so a remove that did not shrink the backlog
    // can never starve the queue by re-issuing itself on every updateend.
    if (!this.trimPending && this.trimBehindPlayhead(TRIM_KEEP_SECONDS, TRIM_THRESHOLD_SECONDS)) {
      return;
    }
    try {
      // DIAGNOSTIC: hex-dump first 32 bytes of the first 3 fragments so we can
      // verify fMP4 box structure byte-for-byte vs the ISO spec on disk.
      if (this.appendCount < 2) {
        const v = new Uint8Array(next, 0, Math.min(next.byteLength, 64));
        const hex = Array.from(v).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.info(`[device] MSE append #${this.appendCount} hex[0..${v.length}]=`, hex);
      }
      sb.appendBuffer(next);
      this.pending.shift();
      this.trimPending = false;
      this.quotaRetryArmed = false;
      // DIAGNOSTIC: report the MSE buffered range (where currentTime lives) on
      // every other successful append. The black-video bug = this range stuck at
      // 0..0 or absent → nothing to paint.
      if ((this.appendCount & 0x3) === 0) {
        try {
          const ranges = sb.buffered;
          const r = ranges.length ? `${ranges.start(0).toFixed(3)}..${ranges.end(0).toFixed(3)}` : "(empty)";
          console.info(
            `[device] MSE appended #${this.appendCount}`,
            `len=${next.byteLength}`,
            `buffered=${r}`,
            `currentTime=${this.video.currentTime.toFixed(3)}`,
            `readyState=${this.video.readyState}`,
          );
        } catch {}
      }
      this.appendCount++;
      if (this.video.paused) {
        void this.video.play().catch(() => {});
      }
    } catch (e) {
      if (!isQuotaError(e)) {
        this.fail(`Video append failed (${describeError(e)})`);
        return;
      }
      // The fragment stays at the head of the queue; updateend after the
      // trim re-enters flushPending and retries it exactly once.
      if (!this.quotaRetryArmed) {
        this.quotaRetryArmed = true;
        if (this.trimBehindPlayhead(0, 0)) return;
      }
      this.fail("Video buffer is full and nothing behind the playhead could be reclaimed");
    }
  }

  // Returns true when a remove was issued; appending resumes on updateend.
  private trimBehindPlayhead(keepSeconds: number, thresholdSeconds: number): boolean {
    const sb = this.sourceBuffer;
    if (!sb) return false;
    let start: number;
    try {
      const buffered = sb.buffered;
      if (buffered.length === 0) return false;
      start = buffered.start(0);
    } catch {
      return false;
    }
    const now = this.video.currentTime;
    const end = now - keepSeconds;
    if (now - start <= thresholdSeconds || end <= start) return false;
    try {
      sb.remove(0, end);
      this.trimPending = true;
      return true;
    } catch (e) {
      console.warn("[device] MSE: remove failed:", e);
      return false;
    }
  }

  // The trim math assumes a remove is extended to the next keyframe at or
  // after `end`, never past the playhead. If the real keyframe interval is
  // longer than assumed, the browser can extend the remove past the
  // playhead's own range; reclaim it by seeking into whatever survived.
  private healPlayheadAfterTrim() {
    const sb = this.sourceBuffer;
    if (!sb) return;
    let buffered: TimeRanges;
    try {
      buffered = sb.buffered;
    } catch {
      return;
    }
    const now = this.video.currentTime;
    let nextStart: number | null = null;
    let lastStart: number | null = null;
    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      if (now >= start && now < end) return;
      if (start > now && (nextStart === null || start < nextStart)) nextStart = start;
      lastStart = start;
    }
    const target = nextStart ?? lastStart;
    if (target === null) return;
    this.video.currentTime = target;
    if (!this.warnedPlayheadDrift) {
      this.warnedPlayheadDrift = true;
      console.warn("[device] MSE: playhead fell outside the buffered ranges after a trim, seeking to", target);
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
