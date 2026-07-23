import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type DeviceEntry = { serial: string; state: string; product?: string; model?: string };

export function DeviceDropdown({ onPick }: { onPick: (serial: string) => void }) {
  const [devices, setDevices] = useState<DeviceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    setDevices(null);
    invoke<DeviceEntry[]>("device_list")
      .then(setDevices)
      .catch((e) => setError(String(e)));
  };

  useEffect(() => void refresh(), []);

  if (error?.includes("adb not found")) {
    return <div className="px-3 py-2 text-[11px] text-destructive">adb not found on PATH.</div>;
  }
  if (error) {
    return <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>;
  }
  if (!devices) {
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">Checking…</div>;
  }
  if (devices.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        No devices. Start an emulator and click Refresh.
      </div>
    );
  }
  return (
    <ul className="flex flex-col">
      {devices.map((d) => (
        <li key={d.serial}>
          <button
            type="button"
            disabled={d.state !== "device"}
            onClick={() => onPick(d.serial)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-accent/50 disabled:opacity-50"
            title={d.state === "device" ? "Open device preview" : `state: ${d.state}`}
          >
            <span className="truncate">{d.model ?? d.serial}</span>
            <span className="text-muted-foreground">{d.serial}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
