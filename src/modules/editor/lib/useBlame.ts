import type { GitBlameCommit } from "@/lib/native";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { commitFileTarget } from "./blame/blameModel";
import { blameCompartment } from "./extensions";

type BlameModule = typeof import("./blame/blameExtension");

export type OpenCommitFile = (input: {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
}) => void;

type Options = {
  cmRef: RefObject<ReactCodeMirrorRef | null>;
  path: string;
  dirty: boolean;
  /** Bytes of the loaded document, null until it is ready. */
  readySize: number | null;
  /** Changes identity whenever the document is (re)read from disk. */
  doc: unknown;
  maxBytes: number;
  onOpenCommitFile?: OpenCommitFile;
};

/**
 * Per-pane blame, off until toggled and never persisted: the module, its
 * CodeMirror extension and the git process all wait for the toggle, so an
 * editor that never asks costs nothing. Refreshed on save and on every read
 * from disk; a dirty buffer is never blamed, since git only sees the disk.
 */
export function useBlame({
  cmRef,
  path,
  dirty,
  readySize,
  doc,
  maxBytes,
  onOpenCommitFile,
}: Options) {
  const modRef = useRef<BlameModule | null>(null);
  const onRef = useRef(false);
  const pathRef = useRef(path);
  pathRef.current = path;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const openRef = useRef(onOpenCommitFile);
  openRef.current = onOpenCommitFile;

  const openCommit = useCallback((commit: GitBlameCommit, repoRoot: string) => {
    const target = commitFileTarget(commit);
    if (!target) return;
    openRef.current?.({
      repoRoot,
      sha: commit.sha,
      shortSha: commit.shortSha,
      subject: commit.summary,
      ...target,
    });
  }, []);

  /** `saved`: the buffer was just written, so it is the disk copy even
   * before the dirty flag re-renders. */
  const refresh = useCallback(
    (saved = false) => {
      const view = cmRef.current?.view;
      const mod = modRef.current;
      if (!onRef.current || !view || !mod) return;
      if (dirtyRef.current && !saved) {
        mod.markBlameStatus(view, "dirty");
        return;
      }
      void mod.requestBlame(view, pathRef.current);
    },
    [cmRef],
  );

  const setOff = useCallback(() => {
    onRef.current = false;
    cmRef.current?.view?.dispatch({
      effects: blameCompartment.reconfigure([]),
    });
  }, [cmRef]);

  const toggle = useCallback(async () => {
    if (onRef.current) {
      setOff();
      return;
    }
    if (readySize === null) return;
    if (readySize > maxBytes) {
      toast.info("Blame is off for files over 4 MB", {
        id: "blame-too-large",
      });
      return;
    }
    onRef.current = true;
    try {
      modRef.current ??= await import("./blame/blameExtension");
    } catch (e) {
      onRef.current = false;
      toast.error("Could not load blame", { description: String(e) });
      return;
    }
    const view = cmRef.current?.view;
    if (!onRef.current || !view) return;
    view.dispatch({
      effects: blameCompartment.reconfigure(
        modRef.current.blameExtension(openCommit),
      ),
    });
    refresh();
  }, [cmRef, maxBytes, openCommit, readySize, refresh, setOff]);

  const openLineCommit = useCallback((): boolean => {
    const view = cmRef.current?.view;
    const mod = modRef.current;
    if (!onRef.current || !view || !mod) return false;
    const hit = mod.commitAtCursor(view.state);
    if (!hit) return false;
    openCommit(hit.commit, hit.repoRoot);
    return true;
  }, [cmRef, openCommit]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run trigger: a fresh read from disk or a rename re-blames the file
  useEffect(() => {
    if (readySize !== null && readySize > maxBytes && onRef.current) {
      setOff();
      return;
    }
    refresh();
  }, [doc, path, readySize, maxBytes, refresh, setOff]);

  return { toggle, openLineCommit, refresh };
}
