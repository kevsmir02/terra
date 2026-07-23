import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";

type DeviceEntry = { serial: string; state: string; product?: string; model?: string };

export function DeviceDropdown({ onPick }: { onPick: (serial: string) => void }) {
  const [devices, setDevices] = useState<DeviceEntry[] | null>(null);
  const [avds, setAvds] = useState<string[] | null>(null);
  const [launchingAvd, setLaunchingAvd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = () => {
    setError(null);
    setIsRefreshing(true);
    invoke<DeviceEntry[]>("device_list")
      .then((list) => {
        setDevices(list);
        if (list.length === 0) {
          invoke<string[]>("device_list_avds")
            .then(setAvds)
            .catch(() => setAvds([]));
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setIsRefreshing(false));
  };

  useEffect(() => void refresh(), []);

  const handleLaunchAvd = async (name: string) => {
    setLaunchingAvd(name);
    try {
      await invoke("device_launch_avd", { name });
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts++;
        try {
          const list = await invoke<DeviceEntry[]>("device_list");
          if (list.length > 0) {
            setDevices(list);
            setLaunchingAvd(null);
            clearInterval(timer);
          }
        } catch {}
        if (attempts > 10) {
          setLaunchingAvd(null);
          clearInterval(timer);
        }
      }, 2000);
    } catch (e) {
      setError(String(e));
      setLaunchingAvd(null);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 text-xs font-semibold text-foreground">
        <span>Devices</span>
        <button
          type="button"
          onClick={refresh}
          disabled={isRefreshing}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
          title="Refresh device & emulator list"
        >
          <HugeiconsIcon icon={RefreshIcon} size={13} className={isRefreshing ? "animate-spin" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      {error?.includes("adb not found") ? (
        <div className="px-3 py-2 text-[11px] text-destructive">adb not found on PATH.</div>
      ) : error ? (
        <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>
      ) : !devices ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">Checking…</div>
      ) : devices.length === 0 ? (
        <div className="flex flex-col gap-2 px-3 py-2 text-[11px] text-muted-foreground">
          <div>No active devices connected.</div>
          {avds && avds.length > 0 ? (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="font-medium text-foreground">Available Emulators:</div>
              {avds.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={launchingAvd !== null}
                  onClick={() => void handleLaunchAvd(name)}
                  className="flex w-full items-center justify-between rounded-md border border-border/60 bg-card px-2.5 py-1 text-left text-xs font-medium text-foreground hover:bg-accent/60 disabled:opacity-50"
                >
                  <span>🚀 Launch {name}</span>
                  {launchingAvd === name && <span className="text-[10px] text-muted-foreground">Booting…</span>}
                </button>
              ))}
            </div>
          ) : (
            <div>Start an emulator or connect a device via USB, then click Refresh.</div>
          )}
        </div>
      ) : (
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
      )}
    </div>
  );
}
