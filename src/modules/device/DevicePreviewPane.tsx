import { invoke, Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { MsePlayer } from "./MsePlayer";
import { DEVICE_KEYCODE, DeviceControlBridge } from "./controlBridge";
import { AdbMissing, NoDevices, UnauthorizedDevice, ServerFailed } from "./emptyStates";
import { DeviceKeyBar } from "./DeviceKeyBar";

type Frame = {
  kind: number;
  bytes: ArrayBuffer | Uint8Array | number[] | Record<string, number>;
};

export function DevicePreviewPane({ serial }: { serial: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<MsePlayer | null>(null);
  const handleRef = useRef<number | null>(null);
  const bridgeRef = useRef<DeviceControlBridge | null>(null);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "adb-missing" }
    | { kind: "no-devices" }
    | { kind: "unauthorized"; serial: string }
    | { kind: "error"; message: string }
    | { kind: "streaming"; devW: number; devH: number }
  >({ kind: "idle" });

  useEffect(() => {
    let disposed = false;

    async function start() {
      try {
        // Pre-flight: ensure devices list contains our serial and is authorized.
        const devices = await invoke<{ serial: string; state: string }[]>("device_list");
        if (disposed) return;
        const match = devices.find((d) => d.serial === serial);
        if (!match) return setStatus({ kind: "no-devices" });
        if (match.state === "unauthorized") return setStatus({ kind: "unauthorized", serial });
        if (match.state !== "device") return setStatus({ kind: "error", message: `Device state: ${match.state}` });

        // Open the channel + session.
        const ch = new Channel<Frame>();
        let frameCount = 0;
        ch.onmessage = (frame) => {
          frameCount++;
          if ((frameCount & 0x7) === 0) {
            console.info("[device] channel frames received:", frameCount, "kind=", frame.kind);
          }
          let raw: ArrayBuffer;
          const bytes: unknown = frame.bytes;
          if (bytes instanceof ArrayBuffer) {
            raw = bytes;
          } else if (bytes instanceof Uint8Array) {
            raw = new Uint8Array(bytes).slice().buffer;
          } else if (Array.isArray(bytes)) {
            raw = new Uint8Array(bytes).buffer;
          } else if (bytes && typeof bytes === "object") {
            raw = new Uint8Array(Object.values(bytes as Record<string, number>)).buffer;
          } else {
            console.warn("[device] channel: unknown frame.bytes shape; dropping");
            return;
          }
          playerRef.current?.pushData(frame.kind, raw);
        };
        const handle = await invoke<number>("device_open", {
          serial,
          onFrame: ch,
        });
        if (disposed) {
          void invoke("device_close", { handle }).catch(() => {});
          return;
        }
        handleRef.current = handle;
        // Touch coordinates must be in the ENCODED VIDEO space, not the
        // device's physical space: scrcpy compares the width/height on each
        // touch against its current video size and silently drops the event on
        // any mismatch. `max_size=1920` downscales a 1080x2400 panel to
        // 864x1920, so the physical size from `wm size` drops every touch.
        // videoWidth/videoHeight is that encoded size, and it is authoritative
        // across rotation, so it is the only correct source here.
        const el = videoRef.current;
        bridgeRef.current = new DeviceControlBridge(
          handle,
          el?.videoWidth || 1080,
          el?.videoHeight || 1920,
        );
        setStatus({ kind: "streaming", devW: el?.videoWidth ?? 0, devH: el?.videoHeight ?? 0 });
      } catch (e) {
        if (disposed) return;
        const msg = String(e);
        if (msg.includes("adb not found")) setStatus({ kind: "adb-missing" });
        else setStatus({ kind: "error", message: msg });
      }
    }

    if (videoRef.current) {
      playerRef.current = new MsePlayer(videoRef.current);
    }
    void start();
    return () => {
      disposed = true;
      // Release anything still held before the session goes away, or the
      // device stays latched mid-touch with no up ever arriving.
      bridgeRef.current?.releaseAll();
      bridgeRef.current = null;
      if (handleRef.current !== null) {
        const handle = handleRef.current;
        handleRef.current = null;
        void invoke("device_close", { handle }).catch(() => {});
      }
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [serial]);

  // The encoded size isn't known until the first frame is decoded, and it
  // changes on rotation. `resize` fires on both, so it is what keeps scrcpy's
  // size check satisfied for the life of the session.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const sync = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        bridgeRef.current?.setVideoSize(el.videoWidth, el.videoHeight);
        setStatus((s) =>
          s.kind === "streaming" ? { ...s, devW: el.videoWidth, devH: el.videoHeight } : s,
        );
      }
    };
    sync();
    el.addEventListener("loadedmetadata", sync);
    el.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("loadedmetadata", sync);
      el.removeEventListener("resize", sync);
    };
  }, []);

  if (status.kind === "adb-missing") return <AdbMissing narrow />;
  if (status.kind === "no-devices") return <NoDevices narrow onRefresh={() => location.reload()} />;
  if (status.kind === "unauthorized")
    return <UnauthorizedDevice narrow serial={status.serial} onRefresh={() => location.reload()} />;
  if (status.kind === "error") return <ServerFailed narrow message={status.message} />;

  return (
    <div className="relative flex h-full w-full flex-col">
      <video
        ref={videoRef}
        className="min-h-0 w-full flex-1 object-contain bg-black touch-none"
        autoPlay
        muted
        playsInline
        onPointerDown={(e) => bridgeRef.current?.handlePointerDown(e)}
        onPointerMove={(e) => bridgeRef.current?.handlePointerMove(e)}
        onPointerUp={(e) => bridgeRef.current?.handlePointerUp(e)}
        onPointerCancel={(e) => bridgeRef.current?.handlePointerCancel(e)}
        onWheel={(e) => bridgeRef.current?.handleWheel(e)}
      />
      <DeviceKeyBar
        disabled={status.kind !== "streaming"}
        onPress={(keycode) => bridgeRef.current?.pressKey(keycode)}
        keycodes={DEVICE_KEYCODE}
      />
    </div>
  );
}
