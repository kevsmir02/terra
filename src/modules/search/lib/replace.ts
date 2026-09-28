import { invoke } from "@tauri-apps/api/core";

export type ReplaceFlags = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export const DEFAULT_FLAGS: ReplaceFlags = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export type ReplaceQuery = ReplaceFlags & {
  pattern: string;
  replacement: string;
  include: string[];
  exclude: string[];
};

export type Edit = {
  start: number;
  end: number;
  line: number;
  before: string;
  matched: string;
  after: string;
  replacement: string;
};

export type FilePreview = {
  path: string;
  rel: string;
  hash: string;
  edits: Edit[];
};

export type ReplacePreview = {
  files: FilePreview[];
  totalMatches: number;
  filesScanned: number;
  truncated: boolean;
  skipped: { path: string; rel: string; reason: "not-utf8" }[];
  skippedLarge: number;
};

export type ApplyFile = {
  path: string;
  hash: string;
  edits: { start: number; end: number; replacement: string }[];
};

export type ApplyResult = {
  path: string;
  outcome: "written" | "conflict" | "failed";
  replaced: number;
  mtime: number | null;
  message: string | null;
};

/** Mirrors `fs::replace::MAX_MATCHES` for the "too many" copy. */
export const MAX_MATCHES = 5000;

export const SUPERSEDED = "superseded";

export function previewReplace(root: string, query: ReplaceQuery) {
  return invoke<ReplacePreview>("fs_replace_preview", { root, query });
}

export function applyReplace(files: ApplyFile[]) {
  return invoke<ApplyResult[]>("fs_replace_apply", { files });
}

/** "src, *.ts ,, docs/" to ["src", "*.ts", "docs/"]. */
export function parseGlobList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function editKey(path: string, edit: Pick<Edit, "start">): string {
  return `${path}\u0000${edit.start}`;
}

export type FileCheck = "checked" | "unchecked" | "indeterminate";

export function fileCheck(file: FilePreview, excluded: Set<string>): FileCheck {
  let off = 0;
  for (const e of file.edits) if (excluded.has(editKey(file.path, e))) off++;
  if (off === 0) return "checked";
  if (off === file.edits.length) return "unchecked";
  return "indeterminate";
}

/** A partially or fully included file is excluded whole; an excluded one is
 * included whole, like a tri-state checkbox. */
export function toggleFile(
  file: FilePreview,
  excluded: Set<string>,
): Set<string> {
  const next = new Set(excluded);
  const include = fileCheck(file, excluded) === "unchecked";
  for (const e of file.edits) {
    const key = editKey(file.path, e);
    if (include) next.delete(key);
    else next.add(key);
  }
  return next;
}

export function toggleEdit(
  path: string,
  edit: Edit,
  excluded: Set<string>,
): Set<string> {
  const next = new Set(excluded);
  const key = editKey(path, edit);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export type ApplyPlan = {
  files: ApplyFile[];
  replacements: number;
  /** Files with included matches that are open with unsaved edits. */
  skippedDirty: string[];
};

/**
 * What Replace All sends: every included match, in file order, minus files
 * whose buffer is dirty, since writing under unsaved edits would either be
 * clobbered by the next save or clobber the edits on reload.
 */
export function planApply(
  preview: ReplacePreview,
  excluded: Set<string>,
  dirty: Set<string>,
): ApplyPlan {
  const files: ApplyFile[] = [];
  const skippedDirty: string[] = [];
  let replacements = 0;
  for (const file of preview.files) {
    const edits = file.edits
      .filter((e) => !excluded.has(editKey(file.path, e)))
      .map((e) => ({ start: e.start, end: e.end, replacement: e.replacement }));
    if (edits.length === 0) continue;
    if (dirty.has(file.path)) {
      skippedDirty.push(file.rel);
      continue;
    }
    files.push({ path: file.path, hash: file.hash, edits });
    replacements += edits.length;
  }
  return { files, replacements, skippedDirty };
}

export type ApplySummary = {
  written: number;
  replaced: number;
  conflicts: { rel: string; message: string }[];
  failed: { rel: string; message: string }[];
  skippedDirty: string[];
};

export function summarizeApply(
  results: ApplyResult[],
  preview: ReplacePreview,
  skippedDirty: string[],
): ApplySummary {
  const relOf = new Map(preview.files.map((f) => [f.path, f.rel]));
  const summary: ApplySummary = {
    written: 0,
    replaced: 0,
    conflicts: [],
    failed: [],
    skippedDirty,
  };
  for (const r of results) {
    const rel = relOf.get(r.path) ?? r.path;
    if (r.outcome === "written") {
      summary.written++;
      summary.replaced += r.replaced;
    } else {
      const entry = { rel, message: r.message ?? r.outcome };
      if (r.outcome === "conflict") summary.conflicts.push(entry);
      else summary.failed.push(entry);
    }
  }
  return summary;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Alt+C / Alt+W / Alt+R, by physical key so a layout cannot remap them. */
export function flagForKey(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  code: string;
}): keyof ReplaceFlags | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.code === "KeyC") return "caseSensitive";
  if (e.code === "KeyW") return "wholeWord";
  if (e.code === "KeyR") return "regex";
  return null;
}
