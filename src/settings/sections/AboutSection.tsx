import { Button } from "@/components/ui/button";
import { useUpdater } from "@/modules/updater";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getName, getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { arch, platform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const REPO_URL = "https://github.com/kevsmir02/terra";

const PLATFORM_LABEL: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
  freebsd: "FreeBSD",
};

export function AboutSection() {
  const [version, setVersion] = useState("");
  const [name, setName] = useState("Terra");
  const [build, setBuild] = useState("");
  const { status, check, download, install } = useUpdater();

  const busy =
    status.kind === "checking" ||
    status.kind === "downloading" ||
    status.kind === "installing";

  const primaryLabel =
    status.kind === "checking"
      ? "Checking…"
      : status.kind === "uptodate"
        ? "You're up to date"
        : status.kind === "available"
          ? status.info.pair
            ? `Download v${status.info.version}`
            : `v${status.info.version} available`
          : status.kind === "downloading"
            ? "Downloading…"
            : status.kind === "staged"
              ? "Restart to install"
              : status.kind === "installing"
                ? "Installing…"
                : status.kind === "error"
                  ? "Check failed, retry"
                  : "Check for updates";

  const onPrimary = () => {
    if (status.kind === "available" && status.info.pair) void download();
    else if (status.kind === "available") void openUrl(status.info.releaseUrl);
    else if (status.kind === "staged") void install();
    else void check();
  };

  const progress =
    status.kind === "downloading" && status.contentLength
      ? Math.min(100, Math.round((status.downloaded / status.contentLength) * 100))
      : null;

  useEffect(() => {
    void getVersion().then(setVersion);
    void getName().then(setName);
    try {
      const p = platform();
      const a = arch();
      const platformLabel = PLATFORM_LABEL[p] ?? p;
      setBuild(`${platformLabel} · ${a}`);
    } catch {
      setBuild("");
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="About" description="" />

      <div className="flex items-center gap-4 rounded-xl border border-border/(--emph-strong) bg-card/(--emph-strong) p-5">
        <img src="/logo.png" alt="" className="size-12" draggable={false} />
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold tracking-tight">
            {name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            Open-source terminal IDE
          </span>
          <span className="mt-1 font-mono text-[11px] text-muted-foreground">
            v{version || "…"}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 text-[12px]">
        <dt className="text-muted-foreground">Build</dt>
        <dd className="font-mono text-[11.5px]">
          {build ? `${build} · v${version}` : `v${version}`}
        </dd>

        <dt className="text-muted-foreground">Bundle ID</dt>
        <dd className="font-mono text-[11.5px]">app.kevsmir02.terra</dd>

        <dt className="text-muted-foreground">License</dt>
        <dd>Apache 2.0</dd>

        <dt className="text-muted-foreground">Source code</dt>
        <dd>
          <button
            type="button"
            onClick={() => void openUrl(REPO_URL)}
            className="inline-flex items-center gap-1.5 rounded-md text-[12px] underline-offset-2 hover:text-foreground hover:underline"
          >
            <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
            kevsmir02/terra
          </button>
        </dd>
      </dl>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button size="sm" onClick={onPrimary} disabled={busy}>
            {primaryLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(REPO_URL)}
            className="gap-1.5"
          >
            <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
            View on GitHub
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openUrl(`${REPO_URL}/issues/new`)}
          >
            Report an issue
          </Button>
        </div>
        {status.kind === "error" && (
          <p className="font-mono text-[10.5px] break-all text-destructive/(--emph-bold)">
            {status.message}
          </p>
        )}
        {status.kind === "staged" && status.message && (
          <p className="font-mono text-[10.5px] break-all text-destructive/(--emph-bold)">
            {status.message}
          </p>
        )}
        {status.kind === "available" && !status.info.pair && (
          <p className="text-[11px] text-muted-foreground">
            This install format updates manually; the button opens the release
            page.
          </p>
        )}
        {progress !== null && (
          <p className="text-[11px] text-muted-foreground">{progress}%</p>
        )}
      </div>
    </div>
  );
}
