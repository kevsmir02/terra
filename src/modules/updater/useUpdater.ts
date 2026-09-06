import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useState } from "react";
import {
  isNewer,
  selectAsset,
  type AssetPair,
  type PackageKind,
  type ReleaseAsset,
} from "./assets";

const GITHUB_LATEST_RELEASE =
  "https://api.github.com/repos/kevsmir02/terra/releases/latest";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  releaseUrl: string;
  /** null when this install format cannot be updated in place. */
  pair: AssetPair | null;
}

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; info: AvailableUpdate }
  | {
      kind: "downloading";
      info: AvailableUpdate;
      downloaded: number;
      contentLength: number | null;
    }
  | {
      kind: "staged";
      info: AvailableUpdate;
      fileName: string;
      message?: string;
    }
  | { kind: "installing"; info: AvailableUpdate }
  | { kind: "error"; message: string };

async function fetchLatest(): Promise<{
  version: string;
  currentVersion: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
} | null> {
  const [currentVersion, res] = await Promise.all([
    getVersion(),
    fetch(GITHUB_LATEST_RELEASE, {
      headers: { Accept: "application/vnd.github+json" },
    }),
  ]);
  if (res.status === 404) {
    throw new Error("No releases published yet.");
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`);
  }
  const data = (await res.json()) as {
    tag_name: string;
    html_url: string;
    assets?: ReleaseAsset[];
  };
  const version = data.tag_name.replace(/^v/, "");
  if (!isNewer(version, currentVersion)) return null;
  return {
    version,
    currentVersion,
    releaseUrl: data.html_url,
    assets: data.assets ?? [],
  };
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });

  const check = useCallback(async () => {
    setStatus({ kind: "checking" });
    try {
      const latest = await fetchLatest();
      if (!latest) {
        setStatus({ kind: "uptodate" });
        return;
      }
      const kind = await invoke<PackageKind>("updater_package_kind");
      const pair = selectAsset(kind, latest.assets);
      setStatus({
        kind: "available",
        info: {
          version: latest.version,
          currentVersion: latest.currentVersion,
          releaseUrl: latest.releaseUrl,
          pair,
        },
      });
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, []);

  const download = useCallback(async () => {
    if (status.kind !== "available" || !status.info.pair) return;
    const { info } = status;
    const pair = info.pair;
    if (!pair) return;

    setStatus({
      kind: "downloading",
      info,
      downloaded: 0,
      contentLength: null,
    });
    const onProgress = new Channel<{
      downloaded: number;
      total: number | null;
    }>();
    onProgress.onmessage = (p) => {
      setStatus({
        kind: "downloading",
        info,
        downloaded: p.downloaded,
        contentLength: p.total,
      });
    };

    try {
      await invoke<string>("updater_download", {
        packageUrl: pair.pkg.browser_download_url,
        signatureUrl: pair.sig.browser_download_url,
        fileName: pair.pkg.name,
        onProgress,
      });
      setStatus({ kind: "staged", info, fileName: pair.pkg.name });
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, [status]);

  const install = useCallback(async () => {
    if (status.kind !== "staged") return;
    const { info, fileName } = status;
    setStatus({ kind: "installing", info });
    try {
      await invoke("updater_install", { fileName });
      await relaunch();
    } catch (err) {
      // Any install failure, cancelled, unauthorized, or otherwise, keeps
      // the staged package, so a retry never costs a re-download.
      setStatus({ kind: "staged", info, fileName, message: String(err) });
    }
  }, [status]);

  const dismiss = useCallback(() => setStatus({ kind: "idle" }), []);

  return { status, check, download, install, dismiss };
}
