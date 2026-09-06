import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { MarkdownViewToggle } from "./MarkdownViewToggle";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type Status =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

const RELOAD_DEBOUNCE_MS = 150;

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

export function MarkdownPreviewPane({ path, visible, onSetView }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  // Follows the disk while mounted: an agent rewriting the document is the
  // normal case. Bursts of writes coalesce, and a re-read keeps the rendered
  // page up instead of flashing the loading state.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const read = (initial: boolean) => {
      if (initial) setStatus({ kind: "loading" });
      invoke<ReadResult>("fs_read_file", {
        path,
      })
        .then((res) => {
          if (cancelled) return;
          if (res.kind === "text") {
            setStatus({ kind: "ready", content: res.content });
          } else if (res.kind === "binary") {
            setStatus({ kind: "binary" });
          } else {
            setStatus({ kind: "toolarge", size: res.size, limit: res.limit });
          }
        })
        .catch((e) => {
          if (!cancelled) setStatus({ kind: "error", message: String(e) });
        });
    };
    read(true);

    const normalized = path.replace(/\\/g, "/");
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        read(false);
      }, RELOAD_DEBOUNCE_MS);
    };
    const dir = parentDir(path);
    watchAdd([dir]);
    const unlistenChanged = listenFsChanged((paths) => {
      if (paths.some((p) => p.replace(/\\/g, "/") === normalized)) schedule();
    });
    const unlistenWritten = getCurrentWebviewWindow().listen<{ path: string }>(
      "fs:file-written",
      (e) => {
        if (e.payload.path.replace(/\\/g, "/") === normalized) schedule();
      },
    );
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      watchRemove([dir]);
      void unlistenChanged.then((un) => un());
      void unlistenWritten.then((un) => un());
    };
  }, [path]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/(--emph-strong) bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-8 py-6">
          {status.kind === "loading" && (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          )}
          {status.kind === "error" && (
            <p className="text-[12px] text-destructive">
              Failed to read file: {status.message}
            </p>
          )}
          {status.kind === "binary" && (
            <p className="text-[12px] text-muted-foreground">
              Binary file: cannot render as markdown.
            </p>
          )}
          {status.kind === "toolarge" && (
            <p className="text-[12px] text-muted-foreground">
              File is {status.size} bytes; limit {status.limit}.
            </p>
          )}
          {status.kind === "ready" && (
            <Streamdown
              className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              mode="static"
              parseIncompleteMarkdown={false}
            >
              {status.content}
            </Streamdown>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
