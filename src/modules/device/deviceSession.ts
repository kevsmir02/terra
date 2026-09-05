import { Channel, invoke } from "@tauri-apps/api/core";
import { DeviceControlBridge } from "./controlBridge";
import { isReady } from "./device";
import type { DeviceEntry } from "./generated/DeviceEntry";
import { MsePlayer } from "./MsePlayer";

export type SessionStatus =
  | { kind: "connecting" }
  | { kind: "adb-missing" }
  | { kind: "no-devices" }
  | { kind: "unauthorized"; serial: string }
  | { kind: "error"; message: string }
  | { kind: "disconnected"; message: string }
  | { kind: "streaming"; devW: number; devH: number };

// Why the backend's reader stopped (session.rs: DeviceExit).
type DeviceExit = { reason: string };

const STREAM_ERROR_PREFIX = "stream-error: ";
const GENERIC_EXIT_MESSAGE = "The device stopped streaming";

const EXIT_MESSAGE: Record<string, string> = {
  "stream-ended": GENERIC_EXIT_MESSAGE,
  "server-unreachable": "The mirror server could not be reached",
  "stream-corrupt": "The stream was corrupted",
};

// A reason is a wire token; this is the line the user reads. An unrecognized
// token falls back to the generic line rather than leaking an internal name.
export function exitMessage(reason: string): string {
  if (reason.startsWith(STREAM_ERROR_PREFIX)) {
    return reason.slice(STREAM_ERROR_PREFIX.length).trim() || GENERIC_EXIT_MESSAGE;
  }
  return EXIT_MESSAGE[reason] ?? GENERIC_EXIT_MESSAGE;
}

// Wire format: [1-byte discriminator][payload], on the same raw byte channel
// the terminal uses (see remux::FRAME_INIT / FRAME_MEDIA on the Rust side).
const FRAME_INIT = 0;
const FRAME_MEDIA = 1;

export function splitFrame(buf: ArrayBuffer): { kind: number; payload: Uint8Array<ArrayBuffer> } | null {
  if (buf.byteLength === 0) return null;
  const kind = new Uint8Array(buf, 0, 1)[0];
  if (kind !== FRAME_INIT && kind !== FRAME_MEDIA) return null;
  return { kind, payload: new Uint8Array<ArrayBuffer>(buf, 1) };
}

export type DeviceSession = {
  readonly bridge: DeviceControlBridge | null;
  close: () => void;
};

// device_close takes up to ~1s on the Rust side (sockets, child poll, adb
// forwards) before the serial is released. Tracking each in-flight close by
// serial lets a fast remount wait it out instead of racing device_open into
// an "already open" rejection.
const pendingCloses = new Map<string, Promise<void>>();

const ALREADY_OPEN_RETRY_WAIT_MS = 250;
const ALREADY_OPEN_RETRY_ATTEMPTS = 2;
const PENDING_CLOSE_BOUND_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A wedged adb can leave device_close never resolving. Wait for it, but not
// forever: once the bound elapses, proceed anyway and let device_open's own
// "already open" retry deal with a close that is still genuinely running.
function boundedWait(pending: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void pending.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function trackClose(serial: string, handle: number): void {
  const closing = invoke<void>("device_close", { handle }).catch(() => {});
  pendingCloses.set(serial, closing);
  void closing.finally(() => {
    if (pendingCloses.get(serial) === closing) pendingCloses.delete(serial);
  });
}

// Safety net for a close that released the serial without ever being tracked
// here (e.g. a session from before this module was loaded). Give any close
// that shows up a chance to finish, then retry device_open exactly once.
async function waitOutAlreadyOpen(serial: string): Promise<void> {
  for (let attempt = 0; attempt < ALREADY_OPEN_RETRY_ATTEMPTS; attempt++) {
    const pending = pendingCloses.get(serial);
    if (pending) {
      await boundedWait(pending, PENDING_CLOSE_BOUND_MS);
      return;
    }
    await sleep(ALREADY_OPEN_RETRY_WAIT_MS);
  }
}

async function openDeviceWithRetry(
  serial: string,
  onFrame: Channel<ArrayBuffer>,
  onExit: Channel<DeviceExit>,
): Promise<number> {
  try {
    return await invoke<number>("device_open", { serial, onFrame, onExit });
  } catch (e) {
    if (!String(e).includes("already open")) throw e;
    await waitOutAlreadyOpen(serial);
    return await invoke<number>("device_open", { serial, onFrame, onExit });
  }
}

// A frame reaching the screen is the only proof the mirror is live, and the
// element announces that by firing one of these with a decoded size.
const FRAME_EVENTS = ["loadeddata", "resize"] as const;

export function openDeviceSession(opts: {
  serial: string;
  video: HTMLVideoElement | null;
  onStatus: (status: SessionStatus) => void;
}): DeviceSession {
  const { serial, video, onStatus } = opts;
  let alive = true;
  let handle: number | null = null;
  let bridge: DeviceControlBridge | null = null;
  let player: MsePlayer | null = null;
  let opened = false;
  let painted = false;
  let announcedStreaming = false;

  const close = () => {
    alive = false;
    // Release anything still held before the session goes away, or the
    // device stays latched mid-touch with no up ever arriving.
    bridge?.releaseAll();
    bridge = null;
    if (handle !== null) {
      const h = handle;
      handle = null;
      trackClose(serial, h);
    }
    for (const type of FRAME_EVENTS) video?.removeEventListener(type, onFrameEvent);
    player?.dispose();
    player = null;
  };

  // Held back until the session is open AND a frame has a size: reporting it
  // when device_open resolves would call a black rectangle a live mirror.
  const announceStreaming = () => {
    if (!alive || !opened || !painted || announcedStreaming || !video) return;
    announcedStreaming = true;
    onStatus({ kind: "streaming", devW: video.videoWidth, devH: video.videoHeight });
  };

  function onFrameEvent() {
    if (!video || video.videoWidth <= 0) return;
    painted = true;
    announceStreaming();
  }

  // A dead decoder pipeline is torn down at once so the backend stops pushing
  // frames nobody can show; the pane then offers a Reconnect over the frozen
  // last frame rather than pretending it is still live.
  const onPlayerError = (message: string) => {
    if (!alive) return;
    close();
    onStatus({ kind: "disconnected", message });
  };
  if (video) {
    player = new MsePlayer(video, onPlayerError);
    for (const type of FRAME_EVENTS) video.addEventListener(type, onFrameEvent);
  }

  const start = async () => {
    try {
      // Pre-flight: ensure devices list contains our serial and is authorized.
      const devices = await invoke<DeviceEntry[]>("device_list");
      if (!alive) return;
      const match = devices.find((d) => d.serial === serial);
      if (!match) {
        onStatus({ kind: "no-devices" });
        return;
      }
      if (match.state === "unauthorized") {
        onStatus({ kind: "unauthorized", serial });
        return;
      }
      if (!isReady(match)) {
        onStatus({ kind: "error", message: `Device state: ${match.state}` });
        return;
      }

      const ch = new Channel<ArrayBuffer>();
      ch.onmessage = (buf) => {
        const frame = splitFrame(buf);
        if (frame) player?.pushData(frame.kind, frame.payload);
      };
      const exitCh = new Channel<DeviceExit>();
      exitCh.onmessage = (exit) => {
        if (!alive) return;
        // The backend only reports an exit it did not initiate, so this is a
        // death: tear the local half down before naming it, and never retry
        // on our own (docs/adr/0001-mirror-does-not-reconnect-automatically.md).
        close();
        onStatus({ kind: "disconnected", message: exitMessage(exit.reason) });
      };
      const pending = pendingCloses.get(serial);
      if (pending) await boundedWait(pending, PENDING_CLOSE_BOUND_MS);
      if (!alive) return;

      const h = await openDeviceWithRetry(serial, ch, exitCh);
      if (!alive) {
        trackClose(serial, h);
        return;
      }
      handle = h;
      // Touch coordinates must be in the ENCODED VIDEO space, not the
      // device's physical space: scrcpy compares the width/height on each
      // touch against its current video size and silently drops the event on
      // any mismatch. videoWidth/videoHeight is that encoded size, and it is
      // authoritative across rotation, so it is the only correct source here.
      bridge = new DeviceControlBridge(h, video?.videoWidth || 1080, video?.videoHeight || 1920);
      opened = true;
      announceStreaming();
    } catch (e) {
      if (!alive) return;
      const msg = String(e);
      onStatus(msg.includes("adb not found") ? { kind: "adb-missing" } : { kind: "error", message: msg });
    }
  };
  void start();

  return {
    get bridge() {
      return bridge;
    },
    close,
  };
}
