import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type { GitDiffContentResult } from "@/lib/native";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useReviewAutoRefresh } from "@/modules/source-control/lib/reviewRefresh";
import {
  commitDiffKey,
  fetchCommitDiff,
  fetchWorkingDiff,
  getCachedDiff,
  sameDiff,
  subscribeDiffInvalidation,
  workingDiffKey,
} from "./lib/diffCache";
import {
  buildSharedExtensions,
  DEFAULT_INDENT,
  languageCompartment,
} from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";
import { patchStats } from "./lib/patchStats";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";

type WorkingSource = {
  kind: "working";
  repoRoot: string;
  path: string;
  mode: "-" | "+";
  originalPath: string | null;
};

type CommitSource = {
  kind: "commit";
  repoRoot: string;
  sha: string;
  path: string;
  originalPath: string | null;
};

type Props = {
  source: WorkingSource | CommitSource;
  chipLabel?: string;
  active: boolean;
  /** A working diff saw the repo change under it; the status should follow. */
  onRepoChanged?: () => void;
};

const LARGE_FILE_THRESHOLD = 256 * 1024;

const SHARED_EXT = buildSharedExtensions();
const READONLY_EXT = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];
const DIFF_THEME = EditorView.theme({
  "&.cm-merge-b .cm-changedText, .cm-changedText": {
    background: "rgba(110, 200, 120, 0.20) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
    background: "rgba(220, 90, 90, 0.22) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine, .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.05) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(220, 90, 90, 0.05) !important",
    paddingTop: "1px",
    paddingBottom: "1px",
  },
  "&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
  },
  ".cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter": {
    background: "rgba(220, 90, 90, 0.5) !important",
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground, #9ca3af)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      diff: GitDiffContentResult;
      /** Resolved before mount: a late compartment reconfigure would leave
       * the merge view's deleted-chunk widgets unhighlighted. */
      langExt: Extension | null;
    }
  | { kind: "error"; message: string };

function cacheKey(source: WorkingSource | CommitSource): string {
  return source.kind === "working"
    ? workingDiffKey(source.repoRoot, source.path, source.mode)
    : commitDiffKey(source.repoRoot, source.sha, source.path);
}

function loadStateFromCache(source: WorkingSource | CommitSource): LoadState {
  const hit = getCachedDiff(cacheKey(source));
  if (!hit) return { kind: "idle" };
  return {
    kind: "loaded",
    diff: hit,
    langExt: resolveLanguageSync(source.path)?.ext ?? null,
  };
}

function errorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

export function GitDiffPane({
  source,
  chipLabel,
  active,
  onRepoChanged,
}: Props) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const themeExt = useEditorThemeExt();
  const [state, setState] = useState<LoadState>(() =>
    active ? loadStateFromCache(source) : { kind: "idle" },
  );
  const [revision, setRevision] = useState(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const key = cacheKey(source);
  const isWorking = source.kind === "working";
  const watchedRoot = active && isWorking ? source.repoRoot : null;

  useEffect(() => {
    if (!watchedRoot) return;
    return subscribeDiffInvalidation((root) => {
      if (root === watchedRoot) setRevision((r) => r + 1);
    });
  }, [watchedRoot]);

  useReviewAutoRefresh(watchedRoot, () => onRepoChanged?.());

  // Keyed on the fetch identity only: the stack rebuilds `source` on every
  // render, and a working diff revalidates, so depending on it would refetch
  // on every parent render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `revision` are the re-run triggers; `source` is read through a ref
  useEffect(() => {
    if (!active) return;
    const src = sourceRef.current;
    const cached = loadStateFromCache(src);
    const hasCached = cached.kind === "loaded";
    if (hasCached) {
      setState((prev) =>
        prev.kind === "loaded" && sameDiff(prev.diff, cached.diff)
          ? prev
          : cached,
      );
      // A commit's diff never changes; a working diff is shown from the
      // cache and revalidated, since it may predate the last agent turn.
      if (src.kind === "commit") return;
    }
    let cancelled = false;
    setState((prev) => (prev.kind === "loaded" ? prev : { kind: "loading" }));
    const promise =
      src.kind === "working"
        ? fetchWorkingDiff(
            src.repoRoot,
            src.path,
            src.mode,
            src.originalPath,
            hasCached,
          )
        : fetchCommitDiff(src.repoRoot, src.sha, src.path, src.originalPath);
    Promise.all([promise, resolveLanguage(src.path).catch(() => null)])
      .then(([res, lang]) => {
        if (cancelled) return;
        setState((prev) =>
          prev.kind === "loaded" && sameDiff(prev.diff, res)
            ? prev
            : { kind: "loaded", diff: res, langExt: lang?.ext ?? null },
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [active, key, revision]);

  const path = source.path;
  const repoRoot = source.repoRoot;
  const mode = source.kind === "working" ? source.mode : "+";
  const loaded = state.kind === "loaded" ? state : null;
  const originalContent = loaded?.diff.originalContent ?? "";
  const modifiedContent = loaded?.diff.modifiedContent ?? "";
  const isBinary = loaded?.diff.isBinary ?? false;
  const fallbackPatch = loaded?.diff.fallbackPatch ?? "";
  const patchTruncated = loaded?.diff.truncated ?? false;
  const isConflict = loaded?.diff.conflict ?? false;

  const isTooLarge =
    (loaded?.diff.tooLarge ?? false) ||
    originalContent.length > LARGE_FILE_THRESHOLD ||
    modifiedContent.length > LARGE_FILE_THRESHOLD;
  const useFallback = isBinary || isTooLarge;

  const langExt = loaded?.langExt ?? null;
  const extensions = useMemo(
    () => [
      ...SHARED_EXT,
      DEFAULT_INDENT,
      languageCompartment.of(langExt ?? []),
      ...READONLY_EXT,
      unifiedMergeView({
        original: originalContent,
        mergeControls: false,
        highlightChanges: true,
        gutter: true,
        syntaxHighlightDeletions: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
      }),
      DIFF_THEME,
    ],
    [originalContent, langExt],
  );

  // Cache-hit path only: the diff came from the cache before the language
  // pack was imported. Resolve and reconfigure once the view exists.
  useEffect(() => {
    if (useFallback || state.kind !== "loaded" || state.langExt) return;
    let cancelled = false;
    resolveLanguage(path).then((res) => {
      if (cancelled || !res) return;
      setState((s) => (s.kind === "loaded" ? { ...s, langExt: res.ext } : s));
    });
    return () => {
      cancelled = true;
    };
  }, [useFallback, path, state]);

  const stats = useMemo(
    () => (useFallback ? patchStats(fallbackPatch) : { added: 0, removed: 0 }),
    [useFallback, fallbackPatch],
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-border/(--emph-strong) bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/(--emph-strong) px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="text-[10px] terra-label">
            {chipLabel ?? mode}
          </Badge>
          {isConflict ? (
            <Badge
              variant="outline"
              className="border-status-conflict/(--emph-strong) text-[10px] text-status-conflict"
            >
              Conflict: ours → theirs
            </Badge>
          ) : null}
          {isBinary ? (
            <Badge variant="secondary" className="text-[10px]">
              Binary / patch fallback
            </Badge>
          ) : isTooLarge ? (
            <Badge variant="secondary" className="text-[10px]">
              Large file / patch view
            </Badge>
          ) : null}
          <span
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={path}
          >
            {path}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[10.5px] tabular-nums text-muted-foreground">
          <span className="truncate max-w-80 font-mono">{repoRoot}</span>
          {useFallback ? (
            <>
              <span className="text-status-added">+{stats.added}</span>
              <span className="text-status-deleted">−{stats.removed}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {state.kind === "loading" || state.kind === "idle" ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            Loading diff…
          </div>
        ) : state.kind === "error" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11.5px] text-destructive">
            {state.message}
          </div>
        ) : useFallback ? (
          <div className="flex h-full min-h-0 flex-col">
            {patchTruncated ? (
              <DiffNotice>
                The patch is over 2 MiB and was cut short; the counts and the
                text below cover only its start.
              </DiffNotice>
            ) : null}
            <ScrollArea className="min-h-0 flex-1">
              <pre className="min-h-full whitespace-pre-wrap wrap-break-word p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
                {fallbackPatch ||
                  (isTooLarge
                    ? "This file is too large to diff here, and no patch was produced for it."
                    : "Diff preview is not available for this file.")}
              </pre>
            </ScrollArea>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {isConflict ? (
              <DiffNotice>
                Unmerged. Removed lines are ours (stage 2), added lines are
                theirs (stage 3). Resolve the file, then mark it resolved in
                Source Control.
              </DiffNotice>
            ) : null}
            <div className="min-h-0 flex-1">
              <CodeMirror
                ref={cmRef}
                value={modifiedContent}
                theme={themeExt}
                extensions={extensions}
                editable={false}
                height="100%"
                className="h-full"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: false,
                  highlightActiveLineGutter: false,
                  searchKeymap: true,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-border/(--emph-soft) bg-foreground/[0.04] px-3 py-1.5 text-[10.5px] leading-snug text-muted-foreground"
    >
      <span className="size-1.5 shrink-0 rounded-circle bg-muted-foreground/(--emph-strong)" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
