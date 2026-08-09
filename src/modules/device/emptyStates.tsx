import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BOOT_PHASE_LABEL, listSystemImages, useAvds, type SystemImage } from "./useAvds";

function Shell({
  title,
  narrow,
  children,
}: {
  title: string;
  narrow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 text-center",
        narrow ? "px-3" : "px-6",
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/(--emph-strong) bg-card text-muted-foreground">
        <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.5} />
      </div>
      <p className="text-[12.5px] font-medium text-foreground">{title}</p>
      <div
        className={cn(
          "leading-relaxed text-muted-foreground",
          // At dock width the install commands in AdbMissing wrap hard; shrink
          // the type and let long tokens break rather than overflow.
          narrow ? "max-w-full text-[11px] break-words" : "max-w-sm text-xs",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function AdbMissing({ narrow }: { narrow?: boolean }) {
  return (
    <Shell title="adb not found" narrow={narrow}>
      Install Android Platform Tools (<code>sudo apt install adb</code>,{" "}
      <code>brew install --cask android-platform-tools</code>, or{" "}
      <code>winget install Google.PlatformTools</code>). Terra shells out to{" "}
      <code>adb</code> but does not bundle it.
    </Shell>
  );
}

/// Offered only when no AVD exists at all. Creation is limited to system images
/// already on disk — downloading one needs sdkmanager, license acceptance and a
/// progress UI, which belongs in Android Studio rather than here.
function CreateAvd({ onCreate, busy }: { onCreate: (name: string, pkg: string) => void; busy: boolean }) {
  const [images, setImages] = useState<SystemImage[] | null>(null);
  const [name, setName] = useState("Terra_Device");
  const [pkg, setPkg] = useState("");

  useEffect(() => {
    void listSystemImages().then((list) => {
      setImages(list);
      if (list.length > 0) setPkg(list[0].package);
    });
  }, []);

  if (!images) return <p className="mt-2">Checking for installed system images…</p>;
  if (images.length === 0) {
    return (
      <p className="mt-2">
        No AVDs and no system images installed. Install one from Android Studio&apos;s SDK Manager
        (or <code>sdkmanager</code>), then click Refresh.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="font-medium text-foreground">Create an emulator</div>
      <input
        aria-label="AVD name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-md border border-border/(--emph-strong) bg-card px-2 py-1 text-xs text-foreground"
      />
      <select
        aria-label="System image"
        value={pkg}
        onChange={(e) => setPkg(e.target.value)}
        className="rounded-md border border-border/(--emph-strong) bg-card px-2 py-1 text-xs text-foreground"
      >
        {images.map((img) => (
          <option key={img.package} value={img.package}>
            {img.apiLevel} · {img.tag} · {img.abi}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !name.trim() || !pkg}
        onClick={() => onCreate(name.trim(), pkg)}
        className="rounded-md border border-border/(--emph-strong) bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/(--emph-strong) disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create AVD"}
      </button>
    </div>
  );
}

export function NoDevices({ narrow, onRefresh }: { narrow?: boolean; onRefresh: () => void }) {
  const { avds, boot, error, busy, launch, stop, create } = useAvds(() => onRefresh());

  return (
    <Shell title="No active devices connected" narrow={narrow}>
      <p className="mb-2">
        Plug in a physical device via USB, or launch an emulator below — it runs headless and
        streams here, so no separate emulator window opens.
      </p>

      {error && <p className="mb-2 break-words text-destructive">{error}</p>}

      {avds && avds.length > 0 ? (
        <div className="my-2 flex flex-col items-stretch justify-center gap-1.5">
          {avds.map((avd) => {
            const booting = boot?.name === avd.name;
            const runningSerial = avd.serial;
            return (
              <div key={avd.name} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy || !!runningSerial}
                  onClick={() => void launch(avd.name)}
                  className="flex min-w-0 flex-1 items-center justify-between rounded-md border border-border/(--emph-strong) bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/(--emph-strong) disabled:opacity-50"
                >
                  <span className="truncate">{avd.name}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                    {booting ? BOOT_PHASE_LABEL[boot.phase] : runningSerial ? "Running" : "Launch"}
                  </span>
                </button>
                {avd.managed && runningSerial && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void stop(runningSerial)}
                    className="shrink-0 rounded-md border border-border/(--emph-strong) px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-accent/(--emph-strong) hover:text-foreground disabled:opacity-50"
                  >
                    Stop
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : avds ? (
        <CreateAvd busy={busy} onCreate={(name, pkg) => void create(name, pkg)} />
      ) : null}

      <button
        type="button"
        onClick={onRefresh}
        className="mt-2 rounded-md border border-border/(--emph-strong) bg-card px-3 py-1 text-[11px] hover:bg-accent/(--emph-medium)"
      >
        Refresh
      </button>
    </Shell>
  );
}

export function UnauthorizedDevice({
  narrow,
  serial,
  onRefresh,
}: {
  narrow?: boolean;
  serial: string;
  onRefresh: () => void;
}) {
  return (
    <Shell title="Device is unauthorized" narrow={narrow}>
      <p>{serial}: accept the USB debugging prompt on the device.</p>
      <button
        type="button"
        onClick={onRefresh}
        className="mt-1 rounded-md border border-border/(--emph-strong) bg-card px-3 py-1 text-[11px] hover:bg-accent/(--emph-medium)"
      >
        Refresh
      </button>
    </Shell>
  );
}

export function ServerFailed({ narrow, message }: { narrow?: boolean; message: string }) {
  return (
    <Shell title="Device preview failed to start" narrow={narrow}>
      <p className="break-words">{message}</p>
      <p className="mt-1">Possibly unsupported Android version for the bundled scrcpy server; check the JAR version in About.</p>
    </Shell>
  );
}
