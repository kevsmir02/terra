import { native } from "@/lib/native";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type MediaKind = "image" | "video" | "audio" | "pdf";

const EXT_KIND: Record<string, MediaKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  ico: "image",
  mp4: "video",
  webm: "video",
  ogg: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  m4a: "audio",
  pdf: "pdf",
};

export function mediaKindFor(path: string): MediaKind | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_KIND[ext] ?? null;
}

type Props = {
  path: string;
  kind: MediaKind;
};

/**
 * Renders a binary preview over `asset://`. The asset scope is empty by
 * default, so access is granted for this one file first and the URL is only
 * built once that succeeds, a file outside the workspace never gets a URL.
 */
export function MediaPreview({ path, kind }: Props) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; url: string }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    native
      .allowAsset(path)
      .then((canonical) => {
        if (!cancelled) {
          setState({ status: "ready", url: convertFileSrc(canonical) });
        }
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const name = path.split(/[\\/]/).pop();

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
        {state.message}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto bg-background p-4">
      {kind === "image" && (
        <img
          src={state.url}
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full rounded-md border border-border object-contain shadow-sm"
          style={{
            backgroundImage:
              "conic-gradient(var(--muted) 0.25turn, transparent 0.25turn 0.5turn, var(--muted) 0.5turn 0.75turn, transparent 0.75turn)",
            backgroundSize: "20px 20px",
          }}
          alt={name}
        />
      )}
      {kind === "video" && (
        // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
        <video
          controls
          preload="metadata"
          className="max-h-full max-w-full"
          src={state.url}
        />
      )}
      {kind === "audio" && (
        // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
        <audio
          controls
          preload="metadata"
          className="w-full max-w-md"
          src={state.url}
        />
      )}
      {kind === "pdf" && (
        <iframe
          src={state.url}
          className="h-full w-full border-none"
          title={name}
          // A PDF viewer needs scripts, but nothing else. Withholding
          // `allow-same-origin` keeps the frame in an opaque origin, and
          // omitting `allow-top-navigation*` stops a crafted PDF from
          // navigating the parent webview, which would expose Tauri IPC.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
