import { notifyDocumentSaved } from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type DiskEvent,
  type DiskState,
  nextDiskState,
} from "./diskState";
import { detectEol, type Eol, normalizeToLf, restoreEol } from "./eol";

// A file vanishing mid atomic-rename is normal; a file the user deleted stays
// gone. Re-checking after this delay tells the two apart.
const MISSING_CONFIRM_MS = 750;

type ReadResult =
  | { kind: "text"; content: string; size: number; mtime: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type FileStat = { size: number; mtime: number; kind: string };

/// Mirrors FORCE_MAX_READ_BYTES in src-tauri fs/file.rs.
export const FORCE_READ_LIMIT = 50 * 1024 * 1024;

export type DocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type Options = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useDocument({ path, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);
  const [diskState, setDiskState] = useState<DiskState>("in-sync");

  const dispatchDisk = useCallback((event: DiskEvent) => {
    setDiskState((s) => nextDiskState(s, event));
  }, []);

  const missingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMissingTimer = useCallback(() => {
    if (missingTimerRef.current) {
      clearTimeout(missingTimerRef.current);
      missingTimerRef.current = null;
    }
  }, []);

  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);

  // Track the saved buffer so we can detect changes cheaply.
  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  const eolRef = useRef<Eol>("\n");
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const diskMtimeRef = useRef<number | null>(null);

  const writeToDisk = useCallback(async () => {
    const content = bufferRef.current;
    const mtime = await invoke<number>("fs_write_file", {
      path,
      content: restoreEol(content, eolRef.current),
      source: "editor",
    });
    diskMtimeRef.current = mtime;
    savedRef.current = content;
    // Edits typed while the write was in flight must stay dirty.
    setDirty(bufferRef.current !== content);
    // The buffer is now the disk contents, which also recreates the file if it
    // had been deleted underneath us.
    clearMissingTimer();
    dispatchDisk({ kind: "saved" });
    notifyDocumentSaved(path);
  }, [path, clearMissingTimer, dispatchDisk]);

  // False when the write was withheld because the file changed on disk
  // since load; overwriting is an explicit user action from the toast.
  const saveNow = useCallback(async (): Promise<boolean> => {
    const known = diskMtimeRef.current;
    if (known !== null) {
      const stat = await invoke<FileStat>("fs_stat", {
        path,
      }).catch(() => null);
      if (stat && stat.mtime !== known) {
        const name = path.split(/[\\/]/).pop() ?? path;
        toast.warning("File changed on disk", {
          id: `save-conflict:${path}`,
          description: `${name} was modified by another program while you had unsaved changes. Overwrite to keep your version.`,
          action: { label: "Overwrite", onClick: () => void writeToDisk() },
        });
        return false;
      }
    }
    await writeToDisk();
    return true;
  }, [path, writeToDisk]);

  // Notify parent of dirty transitions.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  const forceRef = useRef(false);

  // Adopts a read result as the new saved baseline. `skipIfUnchanged` avoids
  // the re-render when disk already matches the buffer (self-save / duplicate
  // watcher event); initial loads must always publish a state.
  const adoptRead = useCallback((res: ReadResult, skipIfUnchanged = false) => {
    if (res.kind === "text") {
      eolRef.current = detectEol(res.content);
      diskMtimeRef.current = res.mtime;
      const content = normalizeToLf(res.content);
      if (skipIfUnchanged && content === savedRef.current) return;
      savedRef.current = content;
      bufferRef.current = content;
      setDirty(false);
      setDoc({ status: "ready", content, size: res.size });
    } else if (res.kind === "binary") {
      setDoc({ status: "binary", size: res.size });
    } else if (res.kind === "toolarge") {
      setDoc({ status: "toolarge", size: res.size, limit: res.limit });
    }
  }, []);

  const readFromDisk = useCallback(
    (force: boolean) =>
      invoke<ReadResult>("fs_read_file", {
        path,
        force,
      }),
    [path],
  );

  // Load on path change.
  useEffect(() => {
    let cancelled = false;
    // "Open anyway" is a per-file decision; a new path starts unforced.
    forceRef.current = false;
    setDoc({ status: "loading" });
    setDirty(false);
    // Divergence is a property of the file being viewed, not of the pane.
    clearMissingTimer();
    setDiskState("in-sync");

    readFromDisk(forceRef.current)
      .then((res) => {
        if (!cancelled) adoptRead(res);
      })
      .catch((e) => {
        if (!cancelled) setDoc({ status: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [readFromDisk, adoptRead, clearMissingTimer]);

  const openAnyway = useCallback(() => {
    forceRef.current = true;
    setDoc({ status: "loading" });
    readFromDisk(true)
      .then(adoptRead)
      .catch((e) => setDoc({ status: "error", message: String(e) }));
  }, [readFromDisk, adoptRead]);

  // Confirms a failed read really means the file is gone, rather than a
  // rename window. Never touches `doc`: a healthy buffer stays on screen and
  // only the banner changes.
  const scheduleMissingCheck = useCallback(() => {
    clearMissingTimer();
    missingTimerRef.current = setTimeout(() => {
      missingTimerRef.current = null;
      void invoke<FileStat>("fs_stat", {
        path,
      })
        .then(() => dispatchDisk({ kind: "reload-succeeded" }))
        .catch(() => dispatchDisk({ kind: "confirmed-missing" }));
    }, MISSING_CONFIRM_MS);
  }, [path, clearMissingTimer, dispatchDisk]);

  // Skipped while dirty: never clobber unsaved edits. Re-checked when the
  // read resolves, since typing can start while it is in flight. A skip is
  // reported so the pane can offer the choice instead of staying silent.
  const reload = useCallback((): boolean => {
    if (dirtyRef.current) {
      dispatchDisk({ kind: "reload-skipped-dirty" });
      return false;
    }
    void readFromDisk(forceRef.current)
      .then((res) => {
        if (!dirtyRef.current) adoptRead(res, true);
        clearMissingTimer();
        dispatchDisk({ kind: "reload-succeeded" });
      })
      // Transient failures (e.g. ENOENT mid atomic-rename) must not replace
      // a healthy buffer with an error screen.
      .catch((e) => {
        console.warn("[editor] reload failed", path, e);
        scheduleMissingCheck();
      });
    return true;
  }, [
    readFromDisk,
    adoptRead,
    path,
    dispatchDisk,
    clearMissingTimer,
    scheduleMissingCheck,
  ]);

  // Writes the buffer back unconditionally. `save()` short-circuits when the
  // buffer is clean, which is the usual state for a file deleted out from
  // under a reader - so recreating it needs to bypass that check.
  const recreateOnDisk = useCallback((): void => {
    void writeToDisk().catch((e) =>
      console.error("[editor] recreate failed", path, e),
    );
  }, [writeToDisk, path]);

  // Throws away local edits in favour of the disk copy. Only reachable from
  // the explicit banner action, never automatically.
  const discardAndReload = useCallback((): void => {
    clearMissingTimer();
    void readFromDisk(forceRef.current)
      .then((res) => {
        setDirty(false);
        adoptRead(res);
        dispatchDisk({ kind: "discarded" });
      })
      .catch((e) => {
        console.warn("[editor] discard-and-reload failed", path, e);
        scheduleMissingCheck();
      });
  }, [
    readFromDisk,
    adoptRead,
    path,
    dispatchDisk,
    clearMissingTimer,
    scheduleMissingCheck,
  ]);

  const save = useCallback(async (): Promise<boolean> => {
    clearAutoSaveTimer();
    if (bufferRef.current === savedRef.current) return true;
    return saveNow();
  }, [clearAutoSaveTimer, saveNow]);

  const onChange = useCallback(
    (next: string) => {
      bufferRef.current = next;
      const isDirty = next !== savedRef.current;
      setDirty(isDirty);

      clearAutoSaveTimer();

      const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
      if (active && isDirty) {
        timeoutRef.current = setTimeout(() => {
          saveNow().catch((e) => console.error("[autosave]", e));
        }, delay);
      }
    },
    [clearAutoSaveTimer, saveNow],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run trigger: switching files must clear the previous file's pending autosave
  useEffect(() => clearAutoSaveTimer, [path, clearAutoSaveTimer]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run trigger: switching files must clear the previous file's missing-file timer
  useEffect(() => clearMissingTimer, [path, clearMissingTimer]);

  return {
    doc,
    dirty,
    diskState,
    onChange,
    save,
    reload,
    discardAndReload,
    recreateOnDisk,
    openAnyway,
  };
}
