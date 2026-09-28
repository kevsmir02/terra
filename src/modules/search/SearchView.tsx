import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { native } from "@/lib/native";
import { cn } from "@/lib/utils";
import {
  FileIconView,
  useIconProvider,
} from "@/modules/explorer/lib/iconProvider";
import {
  applyReplace,
  type ApplySummary,
  DEFAULT_FLAGS,
  type Edit,
  type FilePreview,
  fileCheck,
  flagForKey,
  MAX_MATCHES,
  parseGlobList,
  planApply,
  plural,
  type ReplaceFlags,
  type ReplacePreview,
  type ReplaceQuery,
  summarizeApply,
  toggleEdit,
  toggleFile,
  editKey,
} from "@/modules/search/lib/replace";
import {
  type SearchStatus,
  useReplaceSearch,
} from "@/modules/search/lib/useReplaceSearch";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FilterHorizontalIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Props = {
  root: string | null;
  /** Editor tabs with unsaved edits; their files are never written. */
  dirtyPaths: string[];
  /** Bumped by a user gesture that asks for the find field. */
  focusToken: number;
  onOpenMatch: (path: string, line: number) => void;
};

type Row =
  | { kind: "file"; key: string; file: FilePreview }
  | { kind: "match"; key: string; file: FilePreview; edit: Edit };

type Outcome = ApplySummary & { error?: string };

type Form = {
  pattern: string;
  replacement: string;
  flags: ReplaceFlags;
  include: string;
  exclude: string;
  showFilters: boolean;
};

const ROW_HEIGHT = 24;

const FLAG_TOGGLES: {
  flag: keyof ReplaceFlags;
  glyph: string;
  label: string;
}[] = [
  { flag: "caseSensitive", glyph: "Aa", label: "Match case (Alt+C)" },
  { flag: "wholeWord", glyph: "ab", label: "Whole word (Alt+W)" },
  { flag: "regex", glyph: ".*", label: "Regular expression (Alt+R)" },
];

const INPUT =
  "h-7 w-full bg-muted/(--emph-bold) text-[12px]! placeholder:text-muted-foreground/(--emph-strong) focus-visible:ring-0";

const ICON_BUTTON =
  "flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-primary/(--emph-soft) aria-pressed:text-foreground";

// The sidebar remounts a view on every switch; the form survives that for the
// session so switching to Files and back does not lose the query.
let savedForm: Form = {
  pattern: "",
  replacement: "",
  flags: DEFAULT_FLAGS,
  include: "",
  exclude: "",
  showFilters: false,
};

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function dirname(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i > 0 ? rel.slice(0, i) : "";
}

async function withCanonical(paths: string[]): Promise<Set<string>> {
  const out = new Set(paths);
  const resolved = await Promise.all(
    paths.map((p) => native.canonicalize(p).catch(() => null)),
  );
  for (const r of resolved) if (r) out.add(r);
  return out;
}

export function SearchView({
  root,
  dirtyPaths,
  focusToken,
  onOpenMatch,
}: Props) {
  const [form, setForm] = useState<Form>(savedForm);
  useEffect(() => {
    savedForm = form;
  }, [form]);
  const patch = useCallback(
    (next: Partial<Form>) => setForm((f) => ({ ...f, ...next })),
    [],
  );
  const toggleFlag = useCallback(
    (flag: keyof ReplaceFlags) =>
      setForm((f) => ({ ...f, flags: { ...f.flags, [flag]: !f.flags[flag] } })),
    [],
  );

  const query = useMemo<ReplaceQuery>(
    () => ({
      pattern: form.pattern,
      replacement: form.replacement,
      ...form.flags,
      include: parseGlobList(form.include),
      exclude: parseGlobList(form.exclude),
    }),
    [form],
  );
  const { preview, status, current, refresh } = useReplaceSearch(root, query);

  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new preview has new offsets, so earlier choices no longer name the same matches.
  useEffect(() => {
    setExcluded(new Set());
    setActive(-1);
  }, [preview]);

  const dirtyKey = dirtyPaths.join("\n");
  const dirtyPathsRef = useRef(dirtyPaths);
  dirtyPathsRef.current = dirtyPaths;
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the joined list so an unchanged set of dirty tabs does no IPC.
  useEffect(() => {
    let alive = true;
    void withCanonical(dirtyPathsRef.current).then((set) => {
      if (alive) setDirty(set);
    });
    return () => {
      alive = false;
    };
  }, [dirtyKey]);

  const findRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (focusToken === 0) return;
    findRef.current?.focus();
    findRef.current?.select();
  }, [focusToken]);

  const rows = useMemo<Row[]>(() => {
    if (!preview) return [];
    const out: Row[] = [];
    for (const file of preview.files) {
      out.push({ kind: "file", key: file.path, file });
      if (collapsed.has(file.path)) continue;
      for (const edit of file.edits) {
        out.push({
          kind: "match",
          key: editKey(file.path, edit),
          file,
          edit,
        });
      }
    }
    return out;
  }, [preview, collapsed]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => rows[i]?.key ?? i,
  });

  const plan = useMemo(
    () => (preview ? planApply(preview, excluded, dirty) : null),
    [preview, excluded, dirty],
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const canApply =
    status.kind === "ready" &&
    current &&
    !!preview &&
    !preview.truncated &&
    !!plan &&
    plan.replacements > 0 &&
    !applying;

  const apply = useCallback(async () => {
    if (!preview) return;
    setConfirmOpen(false);
    setApplying(true);
    try {
      const fresh = await withCanonical(dirtyPathsRef.current);
      const next = planApply(preview, excluded, fresh);
      const results =
        next.files.length > 0 ? await applyReplace(next.files) : [];
      setOutcome(summarizeApply(results, preview, next.skippedDirty));
    } catch (e) {
      setOutcome({
        written: 0,
        replaced: 0,
        conflicts: [],
        failed: [],
        skippedDirty: [],
        error: String(e),
      });
    } finally {
      setApplying(false);
      void refresh();
    }
  }, [preview, excluded, refresh]);

  const moveActive = useCallback(
    (next: number) => {
      if (rows.length === 0) return;
      const clamped = Math.max(0, Math.min(rows.length - 1, next));
      setActive(clamped);
      virtualizer.scrollToIndex(clamped, { align: "auto" });
    },
    [rows.length, virtualizer],
  );

  const toggleCollapse = useCallback((path: string, open?: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      const shouldOpen = open ?? next.has(path);
      if (shouldOpen) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleRow = useCallback(
    (row: Row) => {
      if (dirty.has(row.file.path)) return;
      setExcluded((prev) =>
        row.kind === "file"
          ? toggleFile(row.file, prev)
          : toggleEdit(row.file.path, row.edit, prev),
      );
    },
    [dirty],
  );

  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const flag = flagForKey(e);
    if (flag) {
      e.preventDefault();
      toggleFlag(flag);
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canApply) setConfirmOpen(true);
    }
  };

  const onFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      void refresh();
    } else if (e.key === "ArrowDown" && rows.length > 0) {
      e.preventDefault();
      listRef.current?.focus();
      moveActive(Math.max(active, 0));
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[active];
    switch (e.key) {
      case "ArrowDown":
        moveActive(active + 1);
        break;
      case "ArrowUp":
        if (active <= 0) findRef.current?.focus();
        else moveActive(active - 1);
        break;
      case "Home":
        moveActive(0);
        break;
      case "End":
        moveActive(rows.length - 1);
        break;
      case " ":
        if (row) toggleRow(row);
        break;
      case "Enter":
        if (e.ctrlKey || e.metaKey) return;
        if (row?.kind === "match") onOpenMatch(row.file.path, row.edit.line);
        else if (row) toggleCollapse(row.file.path);
        break;
      case "ArrowLeft":
        if (row?.kind === "match") {
          moveActive(rows.findIndex((r) => r.key === row.file.path));
        } else if (row) toggleCollapse(row.file.path, false);
        break;
      case "ArrowRight":
        if (row?.kind === "file") toggleCollapse(row.file.path, true);
        break;
      case "Escape":
        findRef.current?.focus();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const rootName = root ? basename(root.replace(/\/+$/, "")) || root : null;
  const busy = applying || status.kind === "searching";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: panel-wide chords (Alt+C/W/R, Ctrl+Enter) must work from every field and the result list.
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onRootKeyDown}>
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/(--emph-strong) p-2">
        <div className="flex h-5 items-center justify-between">
          <span className="terra-label truncate text-[10px] font-medium text-muted-foreground">
            {rootName ? `Search in ${rootName}` : "Search"}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-pressed={form.showFilters}
              aria-label="Files to include or exclude"
              title="Files to include or exclude"
              onClick={() => patch({ showFilters: !form.showFilters })}
              className={ICON_BUTTON}
            >
              <HugeiconsIcon icon={FilterHorizontalIcon} size={12} />
            </button>
            <button
              type="button"
              aria-label="Search again (Enter)"
              title="Search again (Enter)"
              disabled={!form.pattern || !root}
              onClick={() => void refresh()}
              className={ICON_BUTTON}
            >
              <HugeiconsIcon icon={Refresh01Icon} size={12} />
            </button>
          </div>
        </div>

        <div className="relative">
          <Input
            ref={findRef}
            value={form.pattern}
            placeholder="Find"
            aria-label="Find"
            aria-invalid={status.kind === "error" ? true : undefined}
            disabled={!root || applying}
            className={cn(INPUT, "pr-17")}
            onChange={(e) => patch({ pattern: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" && form.pattern) {
                e.preventDefault();
                patch({ pattern: "" });
                return;
              }
              onFieldKeyDown(e);
            }}
          />
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
            {FLAG_TOGGLES.map((t) => (
              <button
                key={t.flag}
                type="button"
                aria-pressed={form.flags[t.flag]}
                aria-label={t.label}
                title={t.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleFlag(t.flag)}
                className={cn(
                  ICON_BUTTON,
                  "w-auto min-w-5 px-0.5 font-mono text-[10px] leading-none",
                  t.flag === "wholeWord" && "underline",
                )}
              >
                {t.glyph}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Input
            value={form.replacement}
            placeholder={form.flags.regex ? "Replace ($1, $name)" : "Replace"}
            aria-label="Replace"
            disabled={!root || applying}
            className={INPUT}
            onChange={(e) => patch({ replacement: e.target.value })}
            onKeyDown={onFieldKeyDown}
          />
          <Button
            size="xs"
            variant="secondary"
            disabled={!canApply}
            title="Replace all (Ctrl+Enter)"
            onClick={() => setConfirmOpen(true)}
            className="h-7 shrink-0 rounded-md tabular-nums"
          >
            {applying ? <Spinner className="size-3" /> : null}
            {plan && plan.replacements > 0
              ? `Replace ${plan.replacements}`
              : "Replace"}
          </Button>
        </div>

        {form.showFilters ? (
          <>
            <Input
              value={form.include}
              placeholder="Files to include (*.ts, src)"
              aria-label="Files to include"
              disabled={!root || applying}
              className={INPUT}
              onChange={(e) => patch({ include: e.target.value })}
              onKeyDown={onFieldKeyDown}
            />
            <Input
              value={form.exclude}
              placeholder="Files to exclude (dist, *.min.js)"
              aria-label="Files to exclude"
              disabled={!root || applying}
              className={INPUT}
              onChange={(e) => patch({ exclude: e.target.value })}
              onKeyDown={onFieldKeyDown}
            />
          </>
        ) : null}
      </div>

      <StatusLine
        status={status}
        preview={preview}
        included={plan?.replacements ?? 0}
        dirtyFiles={plan?.skippedDirty.length ?? 0}
      />

      {outcome ? (
        <OutcomeBanner outcome={outcome} onDismiss={() => setOutcome(null)} />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState root={rootName} status={status} preview={preview} />
      ) : (
        <div
          ref={listRef}
          role="tree"
          aria-label="Search results"
          aria-busy={busy}
          tabIndex={0}
          onKeyDown={onListKeyDown}
          className={cn(
            "min-h-0 flex-1 overflow-auto py-1 outline-none",
            status.kind === "searching" && "opacity-60",
          )}
        >
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div
                  key={item.key}
                  className="absolute left-0 w-full"
                  style={{
                    top: item.start,
                    height: ROW_HEIGHT,
                  }}
                >
                  {row.kind === "file" ? (
                    <FileRow
                      file={row.file}
                      active={item.index === active}
                      open={!collapsed.has(row.file.path)}
                      dirty={dirty.has(row.file.path)}
                      excluded={excluded}
                      onSelect={() => {
                        setActive(item.index);
                        toggleCollapse(row.file.path);
                      }}
                      onToggle={() => toggleRow(row)}
                    />
                  ) : (
                    <MatchRow
                      edit={row.edit}
                      active={item.index === active}
                      dirty={dirty.has(row.file.path)}
                      included={!excluded.has(editKey(row.file.path, row.edit))}
                      onSelect={() => {
                        setActive(item.index);
                        onOpenMatch(row.file.path, row.edit.line);
                      }}
                      onToggle={() => toggleRow(row)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          size="sm"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            confirmRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace {plural(plan?.replacements ?? 0, "match", "matches")} in{" "}
              {plural(plan?.files.length ?? 0, "file")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Files are written directly and there is no undo here.
              {plan && plan.skippedDirty.length > 0
                ? ` ${plural(plan.skippedDirty.length, "file")} with unsaved edits will be skipped.`
                : ""}{" "}
              A file that changed since the preview is left alone and reported.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction ref={confirmRef} onClick={() => void apply()}>
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusLine({
  status,
  preview,
  included,
  dirtyFiles,
}: {
  status: SearchStatus;
  preview: ReplacePreview | null;
  included: number;
  dirtyFiles: number;
}) {
  let body: ReactNode = null;
  if (status.kind === "searching") {
    body = (
      <span className="flex items-center gap-1.5">
        <Spinner className="size-3" />
        Searching
      </span>
    );
  } else if (status.kind === "error") {
    body = (
      <span role="alert" className="truncate text-destructive">
        {status.message}
      </span>
    );
  } else if (status.kind === "ready" && preview) {
    if (preview.truncated) {
      body = (
        <span role="alert" className="text-status-warning">
          Too many results to replace (over {MAX_MATCHES} matches or 500 files).
          Narrow the search or add files to include.
        </span>
      );
    } else if (preview.totalMatches > 0) {
      const off = preview.totalMatches - included;
      body = (
        <span className="truncate">
          {plural(preview.totalMatches, "result")} in{" "}
          {plural(preview.files.length, "file")}
          {off > 0 ? `, ${off} not replaced` : ""}
          {dirtyFiles > 0 ? `, ${plural(dirtyFiles, "unsaved file")}` : ""}
        </span>
      );
    }
  }
  const notes: string[] = [];
  if (status.kind === "ready" && preview) {
    if (preview.skipped.length > 0)
      notes.push(`${plural(preview.skipped.length, "non-UTF-8 file")} skipped`);
    if (preview.skippedLarge > 0)
      notes.push(
        `${plural(preview.skippedLarge, "file")} over 10 MB not searched`,
      );
  }
  if (!body && notes.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="flex shrink-0 flex-col gap-0.5 px-2.5 py-1.5 text-[10px] text-muted-foreground"
    >
      {body}
      {notes.length > 0 ? (
        <span className="truncate">{notes.join(", ")}</span>
      ) : null}
    </div>
  );
}

function OutcomeBanner({
  outcome,
  onDismiss,
}: {
  outcome: Outcome;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="terra-fade-in mx-2 mb-1.5 flex shrink-0 items-start gap-2 rounded-md border border-border/(--emph-strong) bg-muted/(--emph-bold) px-2 py-1.5 text-[11px]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {outcome.error ? (
          <span className="text-destructive">{outcome.error}</span>
        ) : (
          <span className={outcome.written > 0 ? "text-status-ok" : ""}>
            {outcome.written > 0
              ? `Replaced ${plural(outcome.replaced, "match", "matches")} in ${plural(outcome.written, "file")}.`
              : "Nothing was replaced."}
          </span>
        )}
        {outcome.conflicts.length > 0 ? (
          <OutcomeList
            tone="text-status-warning"
            title={`${plural(outcome.conflicts.length, "file")} changed on disk since the preview and ${outcome.conflicts.length === 1 ? "was" : "were"} left alone. Fresh matches are listed below.`}
            items={outcome.conflicts.map((c) => c.rel)}
          />
        ) : null}
        {outcome.failed.length > 0 ? (
          <OutcomeList
            tone="text-destructive"
            title={`${plural(outcome.failed.length, "file")} could not be written.`}
            items={outcome.failed.map((f) => `${f.rel}: ${f.message}`)}
          />
        ) : null}
        {outcome.skippedDirty.length > 0 ? (
          <OutcomeList
            tone="text-status-warning"
            title={`Skipped ${plural(outcome.skippedDirty.length, "file")} with unsaved edits. Save or revert, then replace again.`}
            items={outcome.skippedDirty}
          />
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className={ICON_BUTTON}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={11} />
      </button>
    </div>
  );
}

function OutcomeList({
  tone,
  title,
  items,
}: {
  tone: string;
  title: string;
  items: string[];
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={tone}>{title}</span>
      <ul className="flex flex-col text-muted-foreground">
        {items.slice(0, 8).map((item) => (
          <li key={item} className="truncate" title={item}>
            {item}
          </li>
        ))}
        {items.length > 8 ? <li>and {items.length - 8} more</li> : null}
      </ul>
    </div>
  );
}

function EmptyState({
  root,
  status,
  preview,
}: {
  root: string | null;
  status: SearchStatus;
  preview: ReplacePreview | null;
}) {
  let text: string | null;
  if (!root) text = "Open a folder to search in it.";
  else if (status.kind === "ready" && preview && preview.totalMatches === 0)
    text = `No results in ${plural(preview.filesScanned, "file")}.`;
  else if (status.kind === "idle")
    text =
      "Enter searches now. Ctrl+Enter replaces all. Down moves into the results, Space toggles one, Enter opens it.";
  else text = null;
  if (!text) return <div className="flex-1" />;
  return (
    <div className="flex-1 px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
      {text}
    </div>
  );
}

const ROW =
  "flex h-6 cursor-pointer items-center gap-1.5 pr-2 text-[12px] select-none";

function FileRow({
  file,
  active,
  open,
  dirty,
  excluded,
  onSelect,
  onToggle,
}: {
  file: FilePreview;
  active: boolean;
  open: boolean;
  dirty: boolean;
  excluded: Set<string>;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const icons = useIconProvider();
  const name = basename(file.rel);
  const dir = dirname(file.rel);
  const check = fileCheck(file, excluded);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled once on the tree, which owns focus and the roving highlight.
    <div
      role="treeitem"
      aria-selected={active}
      aria-expanded={open}
      tabIndex={-1}
      onClick={onSelect}
      className={cn(
        ROW,
        "pl-1.5",
        active ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.045]",
      )}
    >
      <HugeiconsIcon
        icon={open ? ArrowDown01Icon : ArrowRight01Icon}
        size={12}
        className="shrink-0 text-muted-foreground"
      />
      <Checkbox
        tabIndex={-1}
        aria-label={`Replace in ${file.rel}`}
        disabled={dirty}
        checked={
          dirty
            ? false
            : check === "indeterminate"
              ? "indeterminate"
              : check === "checked"
        }
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={onToggle}
      />
      <FileIconView icon={icons.file(name)} className="size-4 shrink-0" />
      <span className="shrink-0 truncate text-foreground">{name}</span>
      <span className="min-w-0 truncate text-[11px] text-muted-foreground">
        {dir}
      </span>
      {dirty ? (
        <span
          title="Open with unsaved edits: skipped"
          className="shrink-0 rounded-sm bg-status-warning/15 px-1 text-[10px] text-status-warning"
        >
          unsaved
        </span>
      ) : null}
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {file.edits.length}
      </span>
    </div>
  );
}

function MatchRow({
  edit,
  active,
  dirty,
  included,
  onSelect,
  onToggle,
}: {
  edit: Edit;
  active: boolean;
  dirty: boolean;
  included: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const live = included && !dirty;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled once on the tree, which owns focus and the roving highlight.
    <div
      role="treeitem"
      aria-selected={active}
      tabIndex={-1}
      onClick={onSelect}
      title={`Line ${edit.line}`}
      className={cn(
        ROW,
        "pl-6",
        active ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.045]",
      )}
    >
      <Checkbox
        tabIndex={-1}
        aria-label={`Replace on line ${edit.line}`}
        disabled={dirty}
        checked={live}
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={onToggle}
      />
      <span className="w-7 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
        {edit.line}
      </span>
      <span
        className={cn("min-w-0 truncate whitespace-pre", !live && "opacity-60")}
      >
        <span className="text-muted-foreground">{edit.before.trimStart()}</span>
        <span
          className={cn(
            "text-foreground",
            live &&
              "bg-status-deleted/20 line-through decoration-status-deleted",
          )}
        >
          {edit.matched}
        </span>
        {live && edit.replacement ? (
          <span className="bg-status-added/20 text-foreground">
            {edit.replacement}
          </span>
        ) : null}
        <span className="text-muted-foreground">{edit.after}</span>
      </span>
    </div>
  );
}
