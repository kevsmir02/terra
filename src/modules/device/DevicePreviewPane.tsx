import { invoke, Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { DevicePreviewTab } from "@/modules/tabs";
import { MsePlayer } from "./MsePlayer";
import { inputBridge } from "./inputBridge";
import { AdbMissing, NoDevices, UnauthorizedDevice, ServerFailed } from "./emptyStates";

type Frame = { kind: number; bytes: Uint8Array };

export function DevicePreviewPane({ tab, visible }: { tab: DevicePreviewTab; visible: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<MsePlayer | null>(null);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "adb-missing" }
    | { kind: "no-devices" }
    | { kind: "unauthorized"; serial: string }
    | { kind: "error"; message: string }
    | { kind: "streaming" }
  >({ kind: "idle" });

  useEffect(() => {
    let disposed = false;
    let frameChannel: Channel | null = null;

    async function start() {
      try {
        // Pre-flight: ensure devices list contains our serial and is authorized.
        const devices = await invoke<{ serial: string; state: string }[]>("device_list");
        const match = devices.find((d) => d.serial === tab.serial);
        if (!match) return setStatus({ kind: "no-devices" });
        if (match.state === "unauthorized") return setStatus({ kind: "unauthorized", serial: tab.serial });
        if (match.state !== "device") return setStatus({ kind: "error", message: `Device state: ${match.state}` });

        // Open the channel + session.
        const ch = new Channel<Frame>();
        frameChannel = ch;
        ch.onmessage = (frame) => {
          // bytes arrive as a Uint8Array (Tauri's Uint8Array wire form).
          playerRef.current?.pushData(frame.kind, frame.bytes);
        };
        const handle = await invoke<number>("device_open", {
          serial: tab.serial,
          onFrame: ch,
        });
        if (disposed) {
          void invoke("device_close", { handle }).catch(() => {});
          return;
        }
        // Store the handle on the tab via a patch; the parent owns the tab state.
        // For v1 we keep this as a local mutation via a callback prop OR through
        // the parent's tab-patch pipeline (pattern used by other tab kinds).
        // The wire-side glue is filled in Task 7 step 2's close handler: it
        // expects tab.deviceHandle to be set. The simplest path is to have the
        // parent wire device_open/device_close so the pane never touches the
        // handle directly; for v1 we lean on the parent wiring done in Task 9.
        setStatus({ kind: "streaming" });
      } catch (e) {
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
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [tab.serial]);

  if (status.kind === "adb-missing") return <AdbMissing />;
  if (status.kind === "no-devices") return <NoDevices onRefresh={() => location.reload()} />;
  if (status.kind === "unauthorized")
    return <UnauthorizedDevice serial={status.serial} onRefresh={() => location.reload()} />;
  if (status.kind === "error") return <ServerFailed message={status.message} />;

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        className="h-full w-full object-contain bg-black"
        autoPlay
        muted
        playsInline
        onPointerDown={inputBridge.onPointerDown(tab.serial)}
        onPointerMove={inputBridge.onPointerMove(tab.serial)}
        onPointerUp={inputBridge.onPointerUp(tab.serial)}
      />
    </div>
  );
}
