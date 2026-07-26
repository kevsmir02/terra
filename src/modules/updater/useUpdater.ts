import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useState } from "react";
import { IS_LINUX } from "@/lib/platform";
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
  | { kind: "staged"; info: AvailableUpdate; fileName: string }
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
      let pair: AssetPair | null = null;
      if (IS_LINUX) {
        const kind = await invoke<PackageKind>("updater_package_kind");
        pair = selectAsset(kind, latest.assets);
      }
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

    setStatus({ kind: "downloading", info, downloaded: 0, contentLength: null });
    try {
      const res = await fetch(pair.pkg.browser_download_url);
      if (!res.ok || !res.body) {
        throw new Error(`download failed (${res.status})`);
      }
      const contentLength = Number(res.headers.get("content-length")) || null;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let downloaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        downloaded += value.length;
        setStatus({ kind: "downloading", info, downloaded, contentLength });
      }
      const bytes = new Uint8Array(downloaded);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      const sigRes = await fetch(pair.sig.browser_download_url);
      if (!sigRes.ok) throw new Error(`signature download failed (${sigRes.status})`);
      const signature = await sigRes.text();

      // Two calls: Tauri sends either JSON args or a raw binary body, never
      // both. The metadata goes first; the package travels as a raw body so a
      // ~15 MB download is not re-encoded into a JS number array.
      await invoke("updater_stage_begin", {
        fileName: pair.pkg.name,
        signature,
      });
      await invoke<string>("updater_stage_finish", bytes);
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
      const message = String(err);
      // A dismissed or refused polkit prompt keeps the staged package, so a
      // retry costs no re-download.
      setStatus(
        message.includes("cancelled") || message.includes("not authorized")
          ? { kind: "staged", info, fileName }
          : { kind: "error", message },
      );
    }
  }, [status]);

  const dismiss = useCallback(() => setStatus({ kind: "idle" }), []);

  return { status, check, download, install, dismiss };
}
