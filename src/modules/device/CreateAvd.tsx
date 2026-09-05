import { useEffect, useState } from "react";
import { listSystemImages, type SystemImage } from "./useAvds";

/// Offered when no AVD exists at all, or via the device picker's Create action.
/// Creation is limited to system images already on disk - downloading one needs
/// sdkmanager, license acceptance and a progress UI, which belongs in Android
/// Studio rather than here.
export function CreateAvd({
  onCreate,
  busy,
  onCreated,
}: {
  onCreate: (name: string, pkg: string) => Promise<boolean>;
  busy: boolean;
  onCreated?: () => void;
}) {
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

  const handleCreate = () => {
    void onCreate(name.trim(), pkg).then((ok) => {
      if (ok) onCreated?.();
    });
  };

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
        onClick={handleCreate}
        className="rounded-md border border-border/(--emph-strong) bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/(--emph-strong) disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create AVD"}
      </button>
    </div>
  );
}
