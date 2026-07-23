// Ported from ws-scrcpy's MsePlayer pattern (Apache-2.0). The MediaSource
// SourceBuffer is fed fMP4 init segment (kind=0) and moof+mdat fragments
// (kind=1) emitted from the Rust read loop. We do not parse NALs here — Rust
// already did. We append bytes to the SourceBuffer when it can accept more.

export class MsePlayer {
  private mediaSource: MediaSource;
  private sourceBuffer: SourceBuffer | null = null;
  private pending: ArrayBuffer[] = [];
  private codecString: string | null = null;
  private appendCount = 0;
  readonly video: HTMLVideoElement;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.mediaSource = new MediaSource();
    video.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener("sourceopen", this.onSourceOpen);
  }

  private onSourceOpen = () => {
    console.info("[device] MSE: sourceopen, readyState=", this.mediaSource.readyState);
    if (this.codecString && !this.sourceBuffer) {
      this.initSourceBuffer();
    }
  };

  private initSourceBuffer() {
    if (!this.codecString || this.sourceBuffer) return;
    try {
      const mimeType = this.codecString.startsWith("video/")
        ? this.codecString
        : `video/mp4; codecs="${this.codecString}"`;
      console.info("[device] MSE: addSourceBuffer", mimeType);
      this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
      // ponytail: "sequence" (default) is more tolerant than "segments" — Chrome
      // doesn't require styp/sidx boxes between our per-NAL moof+mdat fragments.
      // Switch to "segments" only when we batch full access units + add styp.
      this.sourceBuffer.addEventListener("updateend", this.onUpdateEnd);
      this.flushPending();
    } catch (e) {
      console.error("[device] MSE: addSourceBuffer FAILED:", e);
    }
  }

  private onUpdateEnd = () => this.flushPending();

  /** kind: 0 = init segment (carries the codec string in-band),
   *        1 = media fragment bytes. */
  pushData(kind: number, bytes: ArrayBuffer) {
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
    if (!this.sourceBuffer || this.sourceBuffer.updating) return;
    const next = this.pending.shift();
    if (next === undefined) return;
    try {
      // DIAGNOSTIC: hex-dump first 32 bytes of the first 3 fragments so we can
      // verify fMP4 box structure byte-for-byte vs the ISO spec on disk.
      if (this.appendCount < 2) {
        const v = new Uint8Array(next, 0, Math.min(next.byteLength, 64));
        const hex = Array.from(v).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.info(`[device] MSE append #${this.appendCount} hex[0..${v.length}]=`, hex);
      }
      this.sourceBuffer.appendBuffer(next);
      // DIAGNOSTIC: report the MSE buffered range (where currentTime lives) on
      // every other successful append. The black-video bug = this range stuck at
      // 0..0 or absent → nothing to paint.
      if ((this.appendCount & 0x3) === 0) {
        try {
          const ranges = this.sourceBuffer.buffered;
          const r = ranges.length ? `${ranges.start(0).toFixed(3)}..${ranges.end(0).toFixed(3)}` : "(empty)";
          console.info(
            "[device] MSE appended #" + this.appendCount,
            "len=" + next.byteLength,
            "buffered=" + r,
            "currentTime=" + this.video.currentTime.toFixed(3),
            "readyState=" + this.video.readyState,
          );
        } catch {}
      }
      this.appendCount++;
      if (this.video.paused) {
        void this.video.play().catch(() => {});
      }
    } catch (e) {
      console.error("[device] MSE: appendBuffer FAILED:", e,
        "(buffered.checkLength=" + this.sourceBuffer.buffered.length,
        "updating=" + this.sourceBuffer.updating, ")");
    }
  }

  dispose() {
    this.mediaSource.removeEventListener("sourceopen", this.onSourceOpen);
    this.sourceBuffer?.removeEventListener("updateend", this.onUpdateEnd);
    if (this.mediaSource.readyState === "open") {
      try { this.mediaSource.endOfStream(); } catch {}
    }
    URL.revokeObjectURL(this.video.src);
    this.sourceBuffer = null;
    this.pending = [];
  }
}
