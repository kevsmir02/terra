import { useEffect, useRef, useState } from "react";
import { DEVICE_KEYCODE } from "./controlBridge";
import { DeviceKeyBar } from "./DeviceKeyBar";
import { type DeviceSession, openDeviceSession, type SessionStatus } from "./deviceSession";
import {
  AdbMissing,
  NoDevices,
  ServerFailed,
  StreamFailed,
  UnauthorizedDevice,
} from "./emptyStates";

type FallbackStatus = Exclude<SessionStatus, { kind: "connecting" | "streaming" }>;

export function PaneFallback({ status, onRetry }: { status: FallbackStatus; onRetry: () => void }) {
  if (status.kind === "adb-missing") return <AdbMissing narrow />;
  if (status.kind === "no-devices") return <NoDevices narrow onRefresh={onRetry} />;
  if (status.kind === "unauthorized") {
    return <UnauthorizedDevice narrow serial={status.serial} onRefresh={onRetry} />;
  }
  if (status.kind === "error") return <ServerFailed narrow message={status.message} onRetry={onRetry} />;
  return <StreamFailed narrow message={status.message} onReconnect={onRetry} />;
}

// Refresh and Reconnect both remount the session pane. The old instance's
// effect cleanup closes its session first; the new instance's start() waits
// out that close (deviceSession.ts) before opening the same serial again, so
// a fast remount never races the backend's own close teardown.
export function DevicePreviewPane({ serial }: { serial: string }) {
  const [attempt, setAttempt] = useState(0);
  return <SessionPane key={attempt} serial={serial} onRetry={() => setAttempt((n) => n + 1)} />;
}

function SessionPane({ serial, onRetry }: { serial: string; onRetry: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<DeviceSession | null>(null);
  const [status, setStatus] = useState<SessionStatus>({ kind: "connecting" });

  useEffect(() => {
    const session = openDeviceSession({ serial, video: videoRef.current, onStatus: setStatus });
    sessionRef.current = session;
    return () => {
      session.close();
      sessionRef.current = null;
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
        sessionRef.current?.bridge?.setVideoSize(el.videoWidth, el.videoHeight);
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

  if (status.kind !== "connecting" && status.kind !== "streaming") {
    return <PaneFallback status={status} onRetry={onRetry} />;
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      <video
        ref={videoRef}
        className="min-h-0 w-full flex-1 object-contain bg-black touch-none"
        autoPlay
        muted
        playsInline
        onPointerDown={(e) => sessionRef.current?.bridge?.handlePointerDown(e)}
        onPointerMove={(e) => sessionRef.current?.bridge?.handlePointerMove(e)}
        onPointerUp={(e) => sessionRef.current?.bridge?.handlePointerUp(e)}
        onPointerCancel={(e) => sessionRef.current?.bridge?.handlePointerCancel(e)}
        onWheel={(e) => sessionRef.current?.bridge?.handleWheel(e)}
      />
      <DeviceKeyBar
        disabled={status.kind !== "streaming"}
        onPress={(keycode) => sessionRef.current?.bridge?.pressKey(keycode)}
        keycodes={DEVICE_KEYCODE}
      />
    </div>
  );
}
