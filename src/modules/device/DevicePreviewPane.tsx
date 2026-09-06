import {
  Loading03Icon,
  UsbNotConnected01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DEVICE_KEYCODE } from "./controlBridge";
import { deviceDisplayName } from "./device";
import { DeviceKeyBar } from "./DeviceKeyBar";
import {
  type DeviceSession,
  openDeviceSession,
  type SessionStatus,
} from "./deviceSession";
import {
  AdbMissing,
  NoDevices,
  ServerFailed,
  UnauthorizedDevice,
} from "./emptyStates";
import type { DeviceEntry } from "./generated/DeviceEntry";

// The states with no frame behind them. `connecting` and `disconnected` keep
// the video mounted and are drawn as overlays instead.
type FallbackStatus = Exclude<
  SessionStatus,
  { kind: "connecting" | "streaming" | "disconnected" }
>;

export function PaneFallback({
  status,
  onRetry,
}: {
  status: FallbackStatus;
  onRetry: () => void;
}) {
  if (status.kind === "adb-missing") return <AdbMissing narrow />;
  if (status.kind === "no-devices")
    return <NoDevices narrow onRefresh={onRetry} />;
  if (status.kind === "unauthorized") {
    return (
      <UnauthorizedDevice narrow serial={status.serial} onRefresh={onRetry} />
    );
  }
  return <ServerFailed narrow message={status.message} onRetry={onRetry} />;
}

const OVERLAY =
  "absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center";

export function ConnectingOverlay({ device }: { device: DeviceEntry }) {
  return (
    <div
      className={cn(OVERLAY, "pointer-events-none bg-background/(--emph-bold)")}
      role="status"
      aria-live="polite"
    >
      <HugeiconsIcon
        icon={Loading03Icon}
        size={18}
        strokeWidth={1.5}
        className="animate-spin text-muted-foreground"
      />
      <p className="max-w-full break-words text-[11px] text-muted-foreground">
        Connecting to {deviceDisplayName(device)}
      </p>
    </div>
  );
}

export function DisconnectedOverlay({
  message,
  onReconnect,
}: {
  message: string;
  onReconnect: () => void;
}) {
  return (
    <div
      className={cn(OVERLAY, "bg-background/(--emph-medium)")}
      role="status"
      aria-live="polite"
    >
      <HugeiconsIcon
        icon={UsbNotConnected01Icon}
        size={18}
        strokeWidth={1.5}
        className="text-destructive"
      />
      <p className="max-w-full break-words text-[11px] font-medium text-foreground">
        {message}
      </p>
      <button
        type="button"
        onClick={onReconnect}
        className="rounded-md border border-border/(--emph-strong) bg-card px-3 py-1 text-[11px] text-foreground hover:bg-accent/(--emph-medium)"
      >
        Reconnect
      </button>
    </div>
  );
}

// Refresh and Reconnect both remount the session pane. The old instance's
// effect cleanup closes its session first; the new instance's start() waits
// out that close (deviceSession.ts) before opening the same serial again, so
// a fast remount never races the backend's own close teardown.
export function DevicePreviewPane({ device }: { device: DeviceEntry }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <SessionPane
      key={attempt}
      device={device}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}

function SessionPane({
  device,
  onRetry,
}: {
  device: DeviceEntry;
  onRetry: () => void;
}) {
  const { serial } = device;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<DeviceSession | null>(null);
  const [status, setStatus] = useState<SessionStatus>({ kind: "connecting" });

  useEffect(() => {
    const session = openDeviceSession({
      serial,
      video: videoRef.current,
      onStatus: setStatus,
    });
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
          s.kind === "streaming"
            ? { ...s, devW: el.videoWidth, devH: el.videoHeight }
            : s,
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

  if (
    status.kind !== "connecting" &&
    status.kind !== "streaming" &&
    status.kind !== "disconnected"
  ) {
    return <PaneFallback status={status} onRetry={onRetry} />;
  }

  const dead = status.kind === "disconnected";
  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 w-full flex-1">
        <video
          ref={videoRef}
          className={cn(
            "h-full w-full object-contain bg-black touch-none",
            // The last frame stays on screen while dimmed: it is the state the
            // device was left in, and hiding it would lose that context.
            dead && "opacity-40",
          )}
          autoPlay
          muted
          playsInline
          onPointerDown={(e) =>
            sessionRef.current?.bridge?.handlePointerDown(e)
          }
          onPointerMove={(e) =>
            sessionRef.current?.bridge?.handlePointerMove(e)
          }
          onPointerUp={(e) => sessionRef.current?.bridge?.handlePointerUp(e)}
          onPointerCancel={(e) =>
            sessionRef.current?.bridge?.handlePointerCancel(e)
          }
          onWheel={(e) => sessionRef.current?.bridge?.handleWheel(e)}
        />
        {status.kind === "connecting" && <ConnectingOverlay device={device} />}
        {status.kind === "disconnected" && (
          <DisconnectedOverlay message={status.message} onReconnect={onRetry} />
        )}
      </div>
      <DeviceKeyBar
        disabled={status.kind !== "streaming"}
        onPress={(keycode) => sessionRef.current?.bridge?.pressKey(keycode)}
        keycodes={DEVICE_KEYCODE}
      />
    </div>
  );
}
