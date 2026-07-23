import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

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
  return (
    <Shell title="No devices">
      <p>Plug in a device or start an emulator (<code>emulator -avd Pixel_API34</code>).</p>
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
