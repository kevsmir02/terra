import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { BOOT_PHASE_LABEL, useAvds } from "./useAvds";

type DeviceEntry = { serial: string; state: string; product?: string; model?: string };

export function DeviceDropdown({ onPick }: { onPick: (serial: string) => void }) {
  const [devices, setDevices] = useState<DeviceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshDevices = () => {
    setError(null);
    setIsRefreshing(true);
    invoke<DeviceEntry[]>("device_list")
      .then(setDevices)
      .catch((e) => setError(String(e)))
      .finally(() => setIsRefreshing(false));
  };

  // A freshly booted emulator should appear without the user hitting Refresh.
  const {
    avds,
    boot,
    error: avdError,
    busy,
    refresh: refreshAvds,
    launch,
    stop,
  } = useAvds(() => refreshDevices());

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only device probe; refreshDevices is re-created each render and would re-fetch forever
  useEffect(() => refreshDevices(), []);

  const refresh = () => {
    refreshDevices();
    void refreshAvds();
  };

  const shown = error ?? avdError;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/(--emph-soft) text-xs font-semibold text-foreground">
        <span>Devices</span>
        <button
          type="button"
          onClick={refresh}
          disabled={isRefreshing}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent/(--emph-strong) hover:text-foreground disabled:opacity-50"
          title="Refresh device & emulator list"
        >
          <HugeiconsIcon icon={RefreshIcon} size={13} className={isRefreshing ? "animate-spin" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      {shown?.includes("adb not found") ? (
        <div className="px-3 py-2 text-[11px] text-destructive">
          adb not found. Install Android Platform Tools, or set ANDROID_HOME.
        </div>
      ) : shown ? (
        <div className="px-3 py-2 text-[11px] text-destructive">{shown}</div>
      ) : null}

      {!devices ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">Checking…</div>
      ) : (
        <>
          {devices.length > 0 && (
            <ul className="flex flex-col">
              {devices.map((d) => (
                <li key={d.serial}>
                  <button
                    type="button"
                    disabled={d.state !== "device"}
                    onClick={() => onPick(d.serial)}
                    className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/(--emph-medium) disabled:opacity-50"
                    title={d.state === "device" ? "Open device preview" : `state: ${d.state}`}
                  >
                    <span className="truncate">{d.model ?? d.serial}</span>
                    <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                      {d.serial}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {avds && avds.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border/(--emph-soft) px-3 py-2">
              <div className="text-[11px] font-medium text-foreground">Emulators</div>
              {avds.map((avd) => {
                const booting = boot?.name === avd.name;
                const runningSerial = avd.serial;
                // Mirror the device-list gate above: a serial adb hasn't
                // reported as "device" yet (e.g. still "offline" right after
                // boot) has no live session, so picking it must be a no-op
                // rather than a silent dead click.
                const deviceReady = runningSerial
                  ? devices?.some((d) => d.serial === runningSerial && d.state === "device")
                  : false;
                return (
                  <div key={avd.name} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={runningSerial ? !deviceReady : busy}
                      onClick={() =>
                        runningSerial ? onPick(runningSerial) : void launch(avd.name)
                      }
                      className="flex min-w-0 flex-1 items-center justify-between rounded-md border border-border/(--emph-strong) bg-card px-2.5 py-1 text-left text-xs font-medium text-foreground hover:bg-accent/(--emph-strong) disabled:opacity-50"
                      title={
                        runningSerial
                          ? deviceReady
                            ? "Open device preview"
                            : "Device not ready yet"
                          : "Launch headless and stream here"
                      }
                    >
                      <span className="truncate">{avd.name}</span>
                      <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                        {booting
                          ? BOOT_PHASE_LABEL[boot.phase]
                          : runningSerial
                            ? "Running"
                            : "Launch"}
                      </span>
                    </button>
                    {avd.managed && runningSerial && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void stop(runningSerial)}
                        className="shrink-0 rounded-md border border-border/(--emph-strong) px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent/(--emph-strong) hover:text-foreground disabled:opacity-50"
                        title="Stop this emulator"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {devices.length === 0 && (!avds || avds.length === 0) && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              No devices or emulators. Connect a device via USB, or create an AVD.
            </div>
          )}
        </>
      )}
    </div>
  );
}
