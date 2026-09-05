import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MsePlayer, TRIM_KEEP_SECONDS, TRIM_THRESHOLD_SECONDS } from "./MsePlayer";

type Range = [number, number];

class FakeTimeRanges {
  constructor(private readonly ranges: Range[]) {}
  get length() {
    return this.ranges.length;
  }
  start(i: number) {
    return this.ranges[i][0];
  }
  end(i: number) {
    return this.ranges[i][1];
  }
}

class FakeSourceBuffer extends EventTarget {
  updating = false;
  appended: Uint8Array[] = [];
  removed: Range[] = [];
  ranges: Range[] = [];
  failNext: Error[] = [];
  listenerCounts = new Map<string, number>();

  get buffered() {
    return new FakeTimeRanges(this.ranges) as unknown as TimeRanges;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) + 1);
    super.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) - 1);
    super.removeEventListener(type, listener);
  }

  appendBuffer(buf: Uint8Array) {
    if (this.updating) throw new DOMException("busy", "InvalidStateError");
    const err = this.failNext.shift();
    if (err) throw err;
    this.appended.push(buf);
    this.updating = true;
  }

  remove(start: number, end: number) {
    if (this.updating) throw new DOMException("busy", "InvalidStateError");
    if (!(end > start)) throw new TypeError("end must exceed start");
    this.removed.push([start, end]);
    this.ranges = this.ranges
      .map(([s, e]): Range => [Math.max(s, end), e])
      .filter(([s, e]) => e > s);
    this.updating = true;
  }

  finish() {
    this.updating = false;
    this.dispatchEvent(new Event("updateend"));
  }
}

class FakeMediaSource extends EventTarget {
  static instances: FakeMediaSource[] = [];
  readyState = "open";
  mimeTypes: string[] = [];
  sourceBuffers: FakeSourceBuffer[] = [];

  constructor() {
    super();
    FakeMediaSource.instances.push(this);
  }

  addSourceBuffer(mime: string) {
    const sb = new FakeSourceBuffer();
    this.mimeTypes.push(mime);
    this.sourceBuffers.push(sb);
    return sb;
  }

  endOfStream() {
    this.readyState = "ended";
  }
}

class FakeVideoElement extends EventTarget {
  currentTime = 0;
  paused = true;
  readyState = 0;
  src = "";
  error: { code: number } | null = null;
  play = vi.fn(() => Promise.resolve());
}

type FakeVideo = HTMLVideoElement & FakeVideoElement;

function fakeVideo(): FakeVideo {
  return new FakeVideoElement() as unknown as FakeVideo;
}

const CODEC = "avc1.42001E";

function initFrame(moov = new Uint8Array([9, 9])) {
  const codec = new TextEncoder().encode(CODEC);
  const out = new Uint8Array(4 + codec.length + moov.length);
  new DataView(out.buffer).setUint32(0, codec.length, false);
  out.set(codec, 4);
  out.set(moov, 4 + codec.length);
  return out;
}

function fragment(tag: number) {
  return new Uint8Array([tag, tag, tag]);
}

function quotaError() {
  return new DOMException("quota", "QuotaExceededError");
}

function bytes(bufs: Uint8Array[]) {
  return bufs.map((b) => Array.from(b));
}

function lastMediaSource() {
  const ms = FakeMediaSource.instances[FakeMediaSource.instances.length - 1];
  if (!ms) throw new Error("no MediaSource was created");
  return ms;
}

function lastSourceBuffer() {
  const sb = lastMediaSource().sourceBuffers[0];
  if (!sb) throw new Error("no SourceBuffer was created");
  return sb;
}

function setup() {
  const onError = vi.fn<(message: string) => void>();
  const video = fakeVideo();
  const player = new MsePlayer(video, onError);
  player.pushData(0, initFrame());
  const sb = lastSourceBuffer();
  sb.finish();
  return { onError, video, player, sb };
}

beforeEach(() => {
  FakeMediaSource.instances = [];
  vi.stubGlobal("MediaSource", FakeMediaSource);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MsePlayer append cycle", () => {
  it("appends the init segment first and fragments in order, one at a time", () => {
    const player = new MsePlayer(fakeVideo(), vi.fn());
    player.pushData(0, initFrame(new Uint8Array([9, 9])));
    player.pushData(1, fragment(1));
    player.pushData(1, fragment(2));

    const sb = lastSourceBuffer();
    expect(lastMediaSource().mimeTypes).toEqual([`video/mp4; codecs="${CODEC}"`]);
    expect(bytes(sb.appended)).toEqual([[9, 9]]);
    sb.finish();
    expect(bytes(sb.appended)).toEqual([[9, 9], [1, 1, 1]]);
    sb.finish();
    expect(bytes(sb.appended)).toEqual([[9, 9], [1, 1, 1], [2, 2, 2]]);
  });

  it("waits for sourceopen before creating the SourceBuffer", () => {
    const player = new MsePlayer(fakeVideo(), vi.fn());
    const ms = lastMediaSource();
    ms.readyState = "closed";
    player.pushData(0, initFrame());
    player.pushData(1, fragment(1));
    expect(ms.sourceBuffers).toHaveLength(0);

    ms.readyState = "open";
    ms.dispatchEvent(new Event("sourceopen"));
    expect(bytes(lastSourceBuffer().appended)).toEqual([[9, 9]]);
  });
});

describe("MsePlayer buffer trimming", () => {
  it("does not trim while the backlog behind the playhead is under the threshold", () => {
    const { player, sb, video } = setup();
    sb.ranges = [[0, TRIM_THRESHOLD_SECONDS]];
    video.currentTime = TRIM_THRESHOLD_SECONDS;

    player.pushData(1, fragment(1));

    expect(sb.removed).toEqual([]);
    expect(sb.appended).toHaveLength(2);
  });

  it("trims behind the playhead once the backlog crosses the threshold, then resumes appending", () => {
    const { player, sb, video } = setup();
    const now = TRIM_THRESHOLD_SECONDS + 1;
    sb.ranges = [[0, now]];
    video.currentTime = now;

    player.pushData(1, fragment(1));
    expect(sb.removed).toEqual([[0, now - TRIM_KEEP_SECONDS]]);
    expect(sb.appended).toHaveLength(1);

    sb.finish();
    expect(bytes(sb.appended)).toEqual([[9, 9], [1, 1, 1]]);

    player.pushData(1, fragment(2));
    sb.finish();
    expect(sb.removed).toHaveLength(1);
    expect(sb.appended).toHaveLength(3);
  });

  it("seeks into the surviving range and warns once when a trim evicts the playhead", () => {
    const { player, sb, video } = setup();
    const now = TRIM_THRESHOLD_SECONDS + 1;
    sb.ranges = [[0, now]];
    video.currentTime = now;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    player.pushData(1, fragment(1));
    expect(sb.removed).toEqual([[0, now - TRIM_KEEP_SECONDS]]);
    // The browser extends the remove to the next keyframe, evicting further
    // than requested and leaving the playhead stranded ahead of what survives.
    sb.ranges = [[now + 5, now + 30]];
    sb.finish();

    expect(video.currentTime).toBe(now + 5);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not seek or warn when the playhead's range survives a trim", () => {
    const { player, sb, video } = setup();
    const now = TRIM_THRESHOLD_SECONDS + 1;
    sb.ranges = [[0, now]];
    video.currentTime = now;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    player.pushData(1, fragment(1));
    sb.ranges = [[now - TRIM_KEEP_SECONDS, now + 1]];
    sb.finish();

    expect(video.currentTime).toBe(now);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never issues two trims without an append in between", () => {
    const { player, sb, video } = setup();
    const now = TRIM_THRESHOLD_SECONDS + 1;
    sb.ranges = [[0, now]];
    video.currentTime = now;

    player.pushData(1, fragment(1));
    expect(sb.removed).toHaveLength(1);

    sb.ranges = [[0, now]];
    sb.finish();

    expect(sb.removed).toHaveLength(1);
    expect(sb.appended).toHaveLength(2);
  });
});

describe("MsePlayer append failures", () => {
  it("recovers from a quota error by trimming everything behind the playhead and retrying once", () => {
    const { onError, player, sb, video } = setup();
    sb.ranges = [[0, 8]];
    video.currentTime = 8;
    sb.failNext.push(quotaError());

    player.pushData(1, fragment(7));
    expect(sb.removed).toEqual([[0, 8]]);
    expect(sb.appended).toHaveLength(1);

    sb.finish();
    expect(bytes(sb.appended)).toEqual([[9, 9], [7, 7, 7]]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports once and stops accepting data when the retry after a quota trim fails too", () => {
    const { onError, player, sb, video } = setup();
    sb.ranges = [[0, 8]];
    video.currentTime = 8;
    sb.failNext.push(quotaError(), quotaError());

    player.pushData(1, fragment(1));
    sb.finish();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(String));

    player.pushData(1, fragment(2));
    sb.finish();
    expect(sb.appended).toHaveLength(1);
    expect(sb.removed).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("is terminal on a quota error when nothing behind the playhead can be trimmed", () => {
    const { onError, player, sb, video } = setup();
    sb.ranges = [[0, 4]];
    video.currentTime = 0;
    sb.failNext.push(quotaError());

    player.pushData(1, fragment(1));

    expect(sb.removed).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("treats any other append error as terminal without retrying", () => {
    const { onError, player, sb } = setup();
    sb.failNext.push(new DOMException("closed", "InvalidStateError"));

    player.pushData(1, fragment(1));
    expect(sb.removed).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("InvalidStateError");
    expect(sb.listenerCounts.get("updateend")).toBe(0);

    player.pushData(1, fragment(2));
    sb.finish();
    expect(sb.appended).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports once when the MediaSource closes with nothing queued, then ignores further data", () => {
    const { onError, player, sb } = setup();

    lastMediaSource().dispatchEvent(new Event("sourceclose"));

    expect(onError).toHaveBeenCalledTimes(1);
    player.pushData(1, fragment(1));
    expect(sb.appended).toHaveLength(1);
  });

  it("reports once on a video element error, then ignores further data", () => {
    const { onError, player, sb, video } = setup();

    video.dispatchEvent(new Event("error"));

    expect(onError).toHaveBeenCalledTimes(1);
    player.pushData(1, fragment(1));
    expect(sb.appended).toHaveLength(1);
  });

  it("reports once even when both the MediaSource and the video element error", () => {
    const { onError, video } = setup();

    lastMediaSource().dispatchEvent(new Event("sourceclose"));
    video.dispatchEvent(new Event("error"));

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("ignores data and never reports after dispose", () => {
    const { onError, player, sb } = setup();
    player.dispose();
    sb.failNext.push(new DOMException("closed", "InvalidStateError"));

    player.pushData(1, fragment(1));

    expect(sb.appended).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
