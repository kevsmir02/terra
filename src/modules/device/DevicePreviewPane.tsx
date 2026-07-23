import { invoke, Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { DevicePreviewTab } from "@/modules/tabs";
import { MsePlayer } from "./MsePlayer";
import { inputBridge } from "./inputBridge";
import { AdbMissing, NoDevices, UnauthorizedDevice, ServerFailed } from "./emptyStates";

type Frame = {
  kind: number;
  bytes: ArrayBuffer | Uint8Array | number[] | Record<string, number>;
};

export function DevicePreviewPane({ tab }: { tab: DevicePreviewTab }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<MsePlayer | null>(null);
  const handleRef = useRef<number | null>(null);
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
        const match = devices.find((d) => d.serial === tab.serial);
        if (!match) return setStatus({ kind: "no-devices" });
        if (match.state === "unauthorized") return setStatus({ kind: "unauthorized", serial: tab.serial });
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
          serial: tab.serial,
          onFrame: ch,
        });
        if (disposed) {
          void invoke("device_close", { handle }).catch(() => {});
          return;
        }
        handleRef.current = handle;
        // Query the physical display size — video.videoWidth reflects the
        // encoded resolution (may be downscaled), but adb input needs the
        // physical display dimensions for accurate coordinate mapping.
        let devW = 0;
        let devH = 0;
        try {
          [devW, devH] = await invoke<[number, number]>("device_screen_size", { serial: tab.serial });
        } catch { /* keep video fallback in deviceCoords */ }
        setStatus({ kind: "streaming", devW, devH });
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
      if (handleRef.current !== null) {
        const handle = handleRef.current;
        handleRef.current = null;
        void invoke("device_close", { handle }).catch(() => {});
      }
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [tab.serial]);

  if (status.kind === "adb-missing") return <AdbMissing />;
  if (status.kind === "no-devices") return <NoDevices onRefresh={() => location.reload()} />;
  if (status.kind === "unauthorized")
    return <UnauthorizedDevice serial={status.serial} onRefresh={() => location.reload()} />;
  if (status.kind === "error") return <ServerFailed message={status.message} />;

  const { devW = 0, devH = 0 } = status.kind === "streaming" ? status : {};

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        className="h-full w-full object-contain bg-black"
        autoPlay
        muted
        playsInline
        onPointerDown={inputBridge.onPointerDown(tab.serial, devW, devH)}
        onPointerMove={inputBridge.onPointerMove(tab.serial)}
        onPointerUp={inputBridge.onPointerUp(tab.serial, devW, devH)}
      />
    </div>
  );
}
