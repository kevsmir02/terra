import { Channel, invoke } from "@tauri-apps/api/core";
import { DeviceControlBridge } from "./controlBridge";
import { MsePlayer } from "./MsePlayer";

export type SessionStatus =
  | { kind: "connecting" }
  | { kind: "adb-missing" }
  | { kind: "no-devices" }
  | { kind: "unauthorized"; serial: string }
  | { kind: "error"; message: string }
  | { kind: "stream-failed"; message: string }
  | { kind: "streaming"; devW: number; devH: number };

type Frame = {
  kind: number;
  bytes: ArrayBuffer | Uint8Array | number[] | Record<string, number>;
};

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

async function openDeviceWithRetry(serial: string, ch: Channel<Frame>): Promise<number> {
  try {
    return await invoke<number>("device_open", { serial, onFrame: ch });
  } catch (e) {
    if (!String(e).includes("already open")) throw e;
    await waitOutAlreadyOpen(serial);
    return await invoke<number>("device_open", { serial, onFrame: ch });
  }
}

function frameBytes(bytes: unknown): ArrayBuffer | null {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes).slice().buffer;
  if (Array.isArray(bytes)) return new Uint8Array(bytes).buffer;
  if (bytes && typeof bytes === "object") {
    return new Uint8Array(Object.values(bytes as Record<string, number>)).buffer;
  }
  return null;
}

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
    player?.dispose();
    player = null;
  };

  // A dead decoder pipeline is torn down at once so the backend stops pushing
  // frames nobody can show; the pane then offers a fresh session.
  const onPlayerError = (message: string) => {
    if (!alive) return;
    close();
    onStatus({ kind: "stream-failed", message });
  };
  if (video) player = new MsePlayer(video, onPlayerError);

  const start = async () => {
    try {
      // Pre-flight: ensure devices list contains our serial and is authorized.
      const devices = await invoke<{ serial: string; state: string }[]>("device_list");
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
      if (match.state !== "device") {
        onStatus({ kind: "error", message: `Device state: ${match.state}` });
        return;
      }

      const ch = new Channel<Frame>();
      let frameCount = 0;
      ch.onmessage = (frame) => {
        frameCount++;
        if ((frameCount & 0x7) === 0) {
          console.info("[device] channel frames received:", frameCount, "kind=", frame.kind);
        }
        const raw = frameBytes(frame.bytes);
        if (!raw) {
          console.warn("[device] channel: unknown frame.bytes shape; dropping");
          return;
        }
        player?.pushData(frame.kind, raw);
      };
      const pending = pendingCloses.get(serial);
      if (pending) await boundedWait(pending, PENDING_CLOSE_BOUND_MS);
      if (!alive) return;

      const h = await openDeviceWithRetry(serial, ch);
      if (!alive) {
        trackClose(serial, h);
        return;
      }
      handle = h;
      // Touch coordinates must be in the ENCODED VIDEO space, not the
      // device's physical space: scrcpy compares the width/height on each
      // touch against its current video size and silently drops the event on
      // any mismatch. `max_size=1920` downscales a 1080x2400 panel to
      // 864x1920, so the physical size from `wm size` drops every touch.
      // videoWidth/videoHeight is that encoded size, and it is authoritative
      // across rotation, so it is the only correct source here.
      bridge = new DeviceControlBridge(h, video?.videoWidth || 1080, video?.videoHeight || 1920);
      onStatus({ kind: "streaming", devW: video?.videoWidth ?? 0, devH: video?.videoHeight ?? 0 });
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
