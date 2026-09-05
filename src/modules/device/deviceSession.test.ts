import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceControlBridge } from "./controlBridge";
import { exitMessage, openDeviceSession, splitFrame, type SessionStatus } from "./deviceSession";
import type { DeviceEntry } from "./generated/DeviceEntry";

type FakePlayer = {
  video: unknown;
  onError: ((message: string) => void) | undefined;
  pushData: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const players = vi.hoisted(() => [] as FakePlayer[]);

vi.mock("./MsePlayer", () => ({
  MsePlayer: class {
    pushData = vi.fn();
    dispose = vi.fn();
    video: unknown;
    onError: ((message: string) => void) | undefined;
    constructor(video: unknown, onError?: (message: string) => void) {
      this.video = video;
      this.onError = onError;
      players.push(this);
    }
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (msg: unknown) => void = () => {};
  },
}));

const SERIAL = "emulator-5554";
const HANDLE = 7;

function mockBackend(
  devices: DeviceEntry[],
  open: () => Promise<number> = () => Promise.resolve(HANDLE),
) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "device_list") return devices;
    if (cmd === "device_open") return open();
    return undefined;
  });
}

function calls(cmd: string) {
  return vi.mocked(invoke).mock.calls.filter((c) => c[0] === cmd);
}

function channelArg(name: "onFrame" | "onExit") {
  const args = calls("device_open")[0]?.[1] as Record<
    string,
    { onmessage: (msg: never) => void }
  >;
  if (!args) throw new Error("device_open was not invoked");
  return args[name];
}

function openChannel() {
  return channelArg("onFrame") as { onmessage: (msg: ArrayBuffer) => void };
}

function exitChannel() {
  return channelArg("onExit") as { onmessage: (msg: { reason: string }) => void };
}

function encodeFrame(kind: number, payload: number[]): ArrayBuffer {
  return new Uint8Array([kind, ...payload]).buffer;
}

type FakeVideo = HTMLVideoElement & { fire: (type: string) => void };

// The real element only reports a size once a frame is decoded, and it says so
// by firing `loadeddata` / `resize`. Modelling those events is what lets a test
// separate "the backend accepted the session" from "a frame reached the screen".
function fakeVideo(videoWidth = 864, videoHeight = 1920): FakeVideo {
  const listeners = new Map<string, Set<() => void>>();
  return {
    videoWidth,
    videoHeight,
    addEventListener(type: string, fn: () => void) {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
  } as unknown as FakeVideo;
}

type Opened = { onStatus: ReturnType<typeof open>["onStatus"]; video: FakeVideo };

function open(video: FakeVideo = fakeVideo()) {
  const onStatus = vi.fn<(status: SessionStatus) => void>();
  const session = openDeviceSession({ serial: SERIAL, video, onStatus });
  return { onStatus, session, video };
}

/// Waits for the `opens`-th device_open, then decodes a frame, which is the
/// only thing that may promote the session to `streaming`.
async function awaitStreaming(opened: Opened, opens = 1) {
  await vi.waitFor(() => expect(calls("device_open")).toHaveLength(opens), { timeout: 2000 });
  opened.video.fire("loadeddata");
  await vi.waitFor(
    () =>
      expect(opened.onStatus).toHaveBeenLastCalledWith({
        kind: "streaming",
        devW: 864,
        devH: 1920,
      }),
    { timeout: 2000 },
  );
}

async function streaming(video: FakeVideo = fakeVideo()) {
  mockBackend([{ serial: SERIAL, state: "device" }]);
  const opened = open(video);
  await awaitStreaming(opened);
  return opened;
}

beforeEach(() => {
  players.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

describe("splitFrame", () => {
  it("returns null for an empty buffer", () => {
    expect(splitFrame(new ArrayBuffer(0))).toBeNull();
  });

  it("splits an init frame's discriminator and payload", () => {
    const frame = splitFrame(encodeFrame(0, [10, 20, 30]));
    expect(frame).not.toBeNull();
    expect(frame?.kind).toBe(0);
    expect(Array.from(frame?.payload ?? [])).toEqual([10, 20, 30]);
  });

  it("splits a media frame's discriminator and payload", () => {
    const frame = splitFrame(encodeFrame(1, [40, 50]));
    expect(frame).not.toBeNull();
    expect(frame?.kind).toBe(1);
    expect(Array.from(frame?.payload ?? [])).toEqual([40, 50]);
  });

  it("returns a payload view over the source buffer rather than a copy", () => {
    const source = new Uint8Array([1, 7, 8, 9]);
    const frame = splitFrame(source.buffer);
    expect(frame?.payload.buffer).toBe(source.buffer);
    source[1] = 99;
    expect(frame?.payload[0]).toBe(99);
  });

  it("returns null for a discriminator other than init or media", () => {
    expect(splitFrame(encodeFrame(2, [1, 2, 3]))).toBeNull();
  });
});

describe("openDeviceSession pre-flight", () => {
  it("reports no-devices when the serial is not listed and never opens a stream", async () => {
    mockBackend([]);
    const { onStatus } = open();
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith({ kind: "no-devices" }));
    expect(calls("device_open")).toHaveLength(0);
  });

  it("reports an unauthorized device with its serial", async () => {
    mockBackend([{ serial: SERIAL, state: "unauthorized" }]);
    const { onStatus } = open();
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith({ kind: "unauthorized", serial: SERIAL }),
    );
  });

  it("maps a missing adb to its own state", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("adb not found on PATH"));
    const { onStatus } = open();
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith({ kind: "adb-missing" }));
  });
});

describe("openDeviceSession streaming", () => {
  it("stays out of streaming until the video decodes its first frame", async () => {
    mockBackend([{ serial: SERIAL, state: "device" }]);
    const { onStatus, session, video } = open();

    // The bridge exists only once device_open resolved, so the session is
    // fully open here and still must not claim to be streaming.
    await vi.waitFor(() => expect(session.bridge).not.toBeNull());
    expect(onStatus).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "streaming" }));

    video.fire("loadeddata");

    expect(onStatus).toHaveBeenLastCalledWith({ kind: "streaming", devW: 864, devH: 1920 });
    session.close();
  });

  it("promotes to streaming on a resize once the frame has a size", async () => {
    mockBackend([{ serial: SERIAL, state: "device" }]);
    const { onStatus, session, video } = open(fakeVideo(0, 0));
    await vi.waitFor(() => expect(session.bridge).not.toBeNull());

    video.fire("resize");
    expect(onStatus).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "streaming" }));

    const sized = video as unknown as { videoWidth: number; videoHeight: number };
    sized.videoWidth = 1080;
    sized.videoHeight = 2400;
    video.fire("resize");

    expect(onStatus).toHaveBeenLastCalledWith({ kind: "streaming", devW: 1080, devH: 2400 });
    session.close();
  });

  it("opens the stream, feeds frames to the player and exposes a control bridge", async () => {
    const { session } = await streaming();

    openChannel().onmessage(encodeFrame(1, [1, 2, 3]));

    expect(players).toHaveLength(1);
    expect(players[0].pushData).toHaveBeenCalledTimes(1);
    const [kind, payload] = players[0].pushData.mock.calls[0] as [number, Uint8Array];
    expect(kind).toBe(1);
    expect(Array.from(payload)).toEqual([1, 2, 3]);
    expect(session.bridge).toBeInstanceOf(DeviceControlBridge);
  });

  it("close releases the stream and goes quiet", async () => {
    const { onStatus, session } = await streaming();
    const before = onStatus.mock.calls.length;

    session.close();

    expect(calls("device_close")).toEqual([["device_close", { handle: HANDLE }]]);
    expect(players[0].dispose).toHaveBeenCalledTimes(1);
    expect(session.bridge).toBeNull();
    openChannel().onmessage(encodeFrame(1, [1]));
    expect(players[0].pushData).not.toHaveBeenCalled();
    expect(onStatus.mock.calls.length).toBe(before);
  });

  it("closes a handle that arrives after close was requested", async () => {
    let resolveOpen: (handle: number) => void = () => {};
    mockBackend([{ serial: SERIAL, state: "device" }], () => new Promise((r) => (resolveOpen = r)));
    const { onStatus, session } = open();
    await vi.waitFor(() => expect(calls("device_open")).toHaveLength(1));

    session.close();
    resolveOpen(HANDLE);
    await vi.waitFor(() => expect(calls("device_close")).toHaveLength(1));

    expect(calls("device_close")[0][1]).toEqual({ handle: HANDLE });
    expect(onStatus).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "streaming" }));
  });
});

describe("exitMessage", () => {
  it("turns each backend reason into a line a user can read", () => {
    expect(exitMessage("stream-ended")).toBe("The device stopped streaming");
    expect(exitMessage("server-unreachable")).toBe("The mirror server could not be reached");
    expect(exitMessage("stream-corrupt")).toBe("The stream was corrupted");
  });

  it("surfaces the io error text of a read failure", () => {
    expect(exitMessage("stream-error: Connection reset by peer")).toBe(
      "Connection reset by peer",
    );
  });

  it("falls back to the generic line rather than showing an internal token", () => {
    expect(exitMessage("some-reason-added-later")).toBe("The device stopped streaming");
  });
});

describe("openDeviceSession session death", () => {
  it("closes the session and reports disconnected when the backend reports an exit", async () => {
    const { onStatus, session } = await streaming();

    exitChannel().onmessage({ reason: "server-unreachable" });

    expect(onStatus).toHaveBeenLastCalledWith({
      kind: "disconnected",
      message: "The mirror server could not be reached",
    });
    expect(calls("device_close")).toEqual([["device_close", { handle: HANDLE }]]);
    expect(players[0].dispose).toHaveBeenCalledTimes(1);
    expect(session.bridge).toBeNull();
  });

  it("ignores an exit that arrives after the pane already closed the session", async () => {
    const { onStatus, session } = await streaming();
    session.close();
    const before = onStatus.mock.calls.length;

    exitChannel().onmessage({ reason: "stream-ended" });

    expect(onStatus.mock.calls.length).toBe(before);
    expect(calls("device_close")).toHaveLength(1);
  });
});

describe("openDeviceSession player failure", () => {
  it("closes the session and reports disconnected once when the player gives up", async () => {
    const { onStatus, session } = await streaming();
    const onError = players[0].onError;
    expect(onError).toBeTypeOf("function");

    onError?.("Video buffer is full");

    expect(calls("device_close")).toEqual([["device_close", { handle: HANDLE }]]);
    expect(players[0].dispose).toHaveBeenCalledTimes(1);
    expect(session.bridge).toBeNull();
    expect(onStatus).toHaveBeenLastCalledWith({
      kind: "disconnected",
      message: "Video buffer is full",
    });

    onError?.("Video buffer is full");
    session.close();
    expect(calls("device_close")).toHaveLength(1);
    expect(onStatus.mock.calls.filter((c) => c[0].kind === "disconnected")).toHaveLength(1);
  });
});

describe("openDeviceSession reopen", () => {
  it("re-runs the device_list pre-flight and connects once the device shows up", async () => {
    mockBackend([]);
    const first = open();
    await vi.waitFor(() => expect(first.onStatus).toHaveBeenCalledWith({ kind: "no-devices" }));
    first.session.close();

    mockBackend([{ serial: SERIAL, state: "device" }]);
    const second = open();
    await awaitStreaming(second);

    expect(calls("device_list")).toHaveLength(2);
    expect(calls("device_open")).toHaveLength(1);
    second.session.close();
  });
});

describe("openDeviceSession reopen while the previous close is still in flight", () => {
  it("waits for the pending close on the same serial before calling device_open", async () => {
    const first = await streaming();

    let resolveClose: () => void = () => {};
    const closeDeferred = new Promise<void>((r) => {
      resolveClose = r;
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "device_list") return [{ serial: SERIAL, state: "device" }];
      if (cmd === "device_open") return HANDLE;
      if (cmd === "device_close") return closeDeferred;
      return undefined;
    });

    first.session.close();
    expect(calls("device_close")).toHaveLength(1);

    const second = open();
    await vi.waitFor(() => expect(calls("device_list")).toHaveLength(2));
    expect(calls("device_open")).toHaveLength(1);

    resolveClose();
    await awaitStreaming(second, 2);
    expect(calls("device_open")).toHaveLength(2);
    second.session.close();
  });

  it("retries device_open once after an already-open rejection and reaches streaming", async () => {
    let openAttempts = 0;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "device_list") return [{ serial: SERIAL, state: "device" }];
      if (cmd === "device_open") {
        openAttempts++;
        if (openAttempts === 1) throw new Error(`device ${SERIAL} is already open`);
        return HANDLE;
      }
      return undefined;
    });

    const opened = open();
    await awaitStreaming(opened, 2);
    expect(calls("device_open")).toHaveLength(2);
    opened.session.close();
  });

  it("surfaces an error when device_open keeps rejecting as already open", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "device_list") return [{ serial: SERIAL, state: "device" }];
      if (cmd === "device_open") throw new Error(`device ${SERIAL} is already open`);
      return undefined;
    });

    const { onStatus } = open();
    await vi.waitFor(
      () =>
        expect(onStatus).toHaveBeenLastCalledWith(
          expect.objectContaining({ kind: "error", message: expect.stringContaining("already open") }),
        ),
      { timeout: 2000 },
    );
    expect(calls("device_open")).toHaveLength(2);
  });

  it("proceeds to device_open once the bound elapses on a device_close that never settles", async () => {
    const first = await streaming();

    vi.useFakeTimers();
    try {
      let resolveClose: () => void = () => {};
      const neverSettlesYet = new Promise<void>((r) => {
        resolveClose = r;
      });
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "device_list") return [{ serial: SERIAL, state: "device" }];
        if (cmd === "device_open") return HANDLE;
        if (cmd === "device_close") return neverSettlesYet;
        return undefined;
      });

      first.session.close();
      expect(calls("device_close")).toHaveLength(1);

      open();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls("device_open")).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(5000);
      expect(calls("device_open")).toHaveLength(2);

      // Settle the close so it does not leak a stuck pending entry into later tests.
      resolveClose();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for the bound once the pending close settles first", async () => {
    const first = await streaming();

    vi.useFakeTimers();
    try {
      let resolveClose: () => void = () => {};
      const closeDeferred = new Promise<void>((r) => {
        resolveClose = r;
      });
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "device_list") return [{ serial: SERIAL, state: "device" }];
        if (cmd === "device_open") return HANDLE;
        if (cmd === "device_close") return closeDeferred;
        return undefined;
      });

      first.session.close();
      open();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls("device_open")).toHaveLength(1);

      resolveClose();
      await vi.advanceTimersByTimeAsync(100);
      expect(calls("device_open")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
