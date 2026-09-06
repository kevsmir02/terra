import { useState } from "react";
import { avdNameForImage } from "./device";
import { type SdkSetup, useSdkSetup } from "./useSdkSetup";

const BUTTON =
  "rounded-md border border-border/(--emph-strong) bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/(--emph-strong) disabled:opacity-50";

type Offer = Extract<SdkSetup, { stage: "bootstrap" | "image" }>;

/**
 * The bootstrap and the image install differ only in what the one terminal line
 * has to do first, so they differ here only in what the offer says it will do.
 */
function offerCopy(setup: Offer) {
  if (setup.stage === "bootstrap") {
    return {
      title: "Set up the Android SDK",
      body: (
        <>
          Installs the command-line tools into <code>{setup.sdkRoot}</code>,
          then the platform tools, the emulator and one system image. No Android
          Studio. Runs in a terminal tab: several GB, and Google&apos;s SDK
          terms are accepted there rather than here.
        </>
      ),
    };
  }
  return {
    title: "Install an emulator",
    body: (
      <>
        Runs <code>sdkmanager</code> in a terminal tab: several GB, and it asks
        you to accept Google&apos;s SDK licences.
        {setup.extraPackages.length > 0 &&
          ` Also installs ${setup.extraPackages.join(" and ")}.`}
      </>
    ),
  };
}

/**
 * Offered where the SDK has no system image, or no tools at all. Terra resolves
 * the line and runs it in a terminal tab rather than downloading anything
 * itself, so the licence prompts are answered by the user and the download can
 * be watched and cancelled where it runs.
 */
export function InstallEmulator({
  runInTerminal,
  onCreate,
  onCreated,
}: {
  runInTerminal?: (command: string) => void;
  onCreate: (name: string, pkg: string) => Promise<boolean>;
  onCreated?: () => void;
}) {
  const [pkg, setPkg] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const { setup, installing, error, install, check } = useSdkSetup({
    runInTerminal,
    // The image is on disk; turn it into an AVD so the list the user came for
    // is no longer empty. Launching is still theirs to click: a cold boot costs
    // minutes and this already spent a long download.
    onInstalled: async (installed) => {
      const created = await onCreate(avdNameForImage(installed), installed);
      if (created) onCreated?.();
      else setCreateError("Image installed, but creating the AVD failed.");
    },
  });

  if (!setup) return <p className="mt-2">Checking the Android SDK…</p>;

  if (installing) {
    return (
      <div className="mt-2 flex flex-col gap-1.5" role="status">
        <p>
          Installing {installing} in the terminal. Accept the Android SDK
          licences there; this panel picks the image up when it lands.
        </p>
        {createError && <p className="text-destructive">{createError}</p>}
        <button
          type="button"
          onClick={() => void check()}
          className="rounded-md border border-border/(--emph-strong) bg-card px-3 py-1 text-[11px] hover:bg-accent/(--emph-medium)"
        >
          Check now
        </button>
      </div>
    );
  }

  if (setup.stage === "blocked" || !runInTerminal) {
    return (
      <p className="mt-2">
        No AVDs and no system images installed. Install the Android command-line
        tools and one system image (<code>sdkmanager</code>), then click
        Refresh.
        {setup.stage === "blocked" && (
          <span className="mt-1 block text-muted-foreground">
            {setup.reason}
          </span>
        )}
      </p>
    );
  }

  const selected = pkg || setup.candidates[0]?.package || "";
  const { title, body } = offerCopy(setup);

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="font-medium text-foreground">{title}</div>
      <p>{body}</p>
      {error && <p className="break-words text-destructive">{error}</p>}
      <select
        aria-label="System image to install"
        value={selected}
        onChange={(e) => setPkg(e.target.value)}
        className="rounded-md border border-border/(--emph-strong) bg-card px-2 py-1 text-xs text-foreground"
      >
        {setup.candidates.map((img) => (
          <option key={img.package} value={img.package}>
            {img.apiLevel} · {img.tag} · {img.abi}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selected}
        onClick={() => void install(selected)}
        className={BUTTON}
      >
        Install in terminal
      </button>
    </div>
  );
}
