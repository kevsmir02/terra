// Ported from ws-scrcpy's MsePlayer pattern (Apache-2.0). The MediaSource
// SourceBuffer is fed fMP4 init segment (kind=0) and moof+mdat fragments
// (kind=1) emitted from the Rust read loop. We do not parse NALs here — Rust
// already did. We append bytes to the SourceBuffer when it can accept more.

export class MsePlayer {
  private mediaSource: MediaSource;
  private sourceBuffer: SourceBuffer | null = null;
  private pending: ArrayBuffer[] = [];
  private codecString: string | null = null;
  readonly video: HTMLVideoElement;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.mediaSource = new MediaSource();
    video.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener("sourceopen", this.onSourceOpen);
  }

  private onSourceOpen = () => {
    if (!this.codecString) {
      // Codec discovered from the init segment; until then we cannot add a
      // SourceBuffer. Buffer the bytes — the init segment arrives first.
      return;
    }
    this.sourceBuffer = this.mediaSource.addSourceBuffer(this.codecString);
    this.sourceBuffer.mode = "segments";
    this.sourceBuffer.addEventListener("updateend", this.onUpdateEnd);
    this.flushPending();
  };

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
      this.pending.push(remainder);
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
      this.sourceBuffer.appendBuffer(next);
    } catch (e) {
      console.error("[device] sourceBuffer.appendBuffer failed:", e);
      // Drop the fragment on a queue-full; next updateend re-tries.
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
