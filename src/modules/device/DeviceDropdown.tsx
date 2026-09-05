import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { CreateAvd } from "./CreateAvd";
import { deviceDisplayName, isReady } from "./device";
import type { DeviceEntry } from "./generated/DeviceEntry";
import { BOOT_PHASE_LABEL, useAvds } from "./useAvds";

export function DeviceDropdown({ onPick }: { onPick: (device: DeviceEntry) => void }) {
  const [devices, setDevices] = useState<DeviceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // Scoped to this component's own create call: `busy` from useAvds also
  // covers launch/stop, and a cold boot can hold it for minutes, so reusing
  // it here would pin the toggle disabled for an unrelated AVD's launch.
  const [creating, setCreating] = useState(false);

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
    create,
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
                    disabled={!isReady(d)}
                    onClick={() => onPick(d)}
                    className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/(--emph-medium) disabled:opacity-50"
                    title={isReady(d) ? "Open device preview" : `state: ${d.state}`}
                  >
                    <span className="truncate">{deviceDisplayName(d)}</span>
                    <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                      {d.serial}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {devices.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              No devices connected. Plug one in via USB, or create an emulator below.
            </div>
          )}

          {avds && (
            <div className="flex flex-col gap-1 border-t border-border/(--emph-soft) px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-foreground">Emulators</span>
                <button
                  type="button"
                  onClick={() => setShowCreate((v) => !v)}
                  disabled={creating}
                  aria-expanded={showCreate}
                  className="rounded px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent/(--emph-strong) hover:text-foreground disabled:opacity-50"
                  title={showCreate ? "Cancel creating an emulator" : "Create a new emulator"}
                >
                  {showCreate ? "Cancel" : "Create"}
                </button>
              </div>
              {avds.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No emulators yet</p>
              )}
              {avds.map((avd) => {
                const booting = boot?.name === avd.name;
                const runningSerial = avd.serial;
                // Mirror the device-list gate above: a serial adb hasn't
                // reported as "device" yet (e.g. still "offline" right after
                // boot) has no live session, so picking it must be a no-op
                // rather than a silent dead click.
                const readyDevice = runningSerial
                  ? devices?.find((d) => d.serial === runningSerial && isReady(d))
                  : undefined;
                return (
                  <div key={avd.name} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={runningSerial ? !readyDevice : busy}
                      onClick={() =>
                        readyDevice ? onPick(readyDevice) : void launch(avd.name)
                      }
                      className="flex min-w-0 flex-1 items-center justify-between rounded-md border border-border/(--emph-strong) bg-card px-2.5 py-1 text-left text-xs font-medium text-foreground hover:bg-accent/(--emph-strong) disabled:opacity-50"
                      title={
                        runningSerial
                          ? readyDevice
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
              {showCreate && (
                <CreateAvd
                  busy={busy}
                  onCreate={async (name, pkg) => {
                    setCreating(true);
                    try {
                      return await create(name, pkg);
                    } finally {
                      setCreating(false);
                    }
                  }}
                  onCreated={() => setShowCreate(false)}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
