import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.5} />
      </div>
      <p className="text-[12.5px] font-medium text-foreground">{title}</p>
      <div className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

export function AdbMissing() {
  return (
    <Shell title="adb not found">
      Install Android Platform Tools (<code>sudo apt install adb</code>,{" "}
      <code>brew install --cask android-platform-tools</code>, or{" "}
      <code>winget install Google.PlatformTools</code>). Terra shells out to
      <code>adb</code> but does not bundle it.
    </Shell>
  );
}

export function NoDevices({ onRefresh }: { onRefresh: () => void }) {
  const [avds, setAvds] = useState<string[] | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);

  useEffect(() => {
    invoke<string[]>("device_list_avds")
      .then(setAvds)
      .catch(() => setAvds([]));
  }, []);

  const handleLaunch = async (name: string) => {
    setLaunching(name);
    try {
      await invoke("device_launch_avd", { name });
      setTimeout(onRefresh, 3000);
    } catch {}
  };

  return (
    <Shell title="No active devices connected">
      <p className="mb-2">Plug in a physical device via USB or launch an emulator below.</p>
      {avds && avds.length > 0 ? (
        <div className="flex flex-col gap-1.5 items-center justify-center my-2">
          {avds.map((name) => (
            <button
              key={name}
              type="button"
              disabled={launching !== null}
              onClick={() => void handleLaunch(name)}
              className="rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/60 disabled:opacity-50"
            >
              🚀 Launch {name} {launching === name ? "(Booting…)" : ""}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onRefresh}
        className="mt-2 rounded-md border border-border/60 bg-card px-3 py-1 text-[11px] hover:bg-accent/50"
      >
        Refresh
      </button>
    </Shell>
  );
}

export function UnauthorizedDevice({ serial, onRefresh }: { serial: string; onRefresh: () => void }) {
  return (
    <Shell title="Device is unauthorized">
      <p>{serial}: accept the USB debugging prompt on the device.</p>
      <button
        type="button"
        onClick={onRefresh}
        className="mt-1 rounded-md border border-border/60 bg-card px-3 py-1 text-[11px] hover:bg-accent/50"
      >
        Refresh
      </button>
    </Shell>
  );
}

export function ServerFailed({ message }: { message: string }) {
  return (
    <Shell title="Device preview failed to start">
      <p className="break-words">{message}</p>
      <p className="mt-1">Possibly unsupported Android version for the bundled scrcpy server; check the JAR version in About.</p>
    </Shell>
  );
}
