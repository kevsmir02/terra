import type { GitBlame, GitBlameCommit } from "@/lib/native";
import {
  ChangeSet,
  MapMode,
  type ChangeDesc,
  type EditorState,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type Text,
  type Transaction,
} from "@codemirror/state";
import type { BlameStatus } from "./blameModel";

/** A line start owned by `commits[commit]`. It belongs to the character after
 * it: a line typed above does not take its commit, and deleting its line
 * deletes it rather than landing it on the next line's start. */
class CommitMark extends RangeValue {
  constructor(readonly commit: number) {
    super();
  }
  override startSide = 1;
  override endSide = 1;
  override mapMode = MapMode.TrackAfter;
  override point = true;
  override eq(other: RangeValue): boolean {
    return other instanceof CommitMark && other.commit === this.commit;
  }
}

export type BlameField = {
  status: BlameStatus;
  repoRoot: string | null;
  commits: GitBlameCommit[];
  marks: RangeSet<CommitMark>;
  request: number;
  /** The document the pending request blamed, and every change since. */
  requested: Text | null;
  pending: ChangeSet | null;
  error: string | null;
};

export const blameRequested = StateEffect.define<{ id: number }>();
export const blameSkipped = StateEffect.define<{ status: BlameStatus }>();
export type BlameLoad = {
  id: number;
  result: GitBlame | { kind: "error"; message: string };
};
export const blameLoaded = StateEffect.define<BlameLoad>();

const EMPTY: BlameField = {
  status: "loading",
  repoRoot: null,
  commits: [],
  marks: RangeSet.empty,
  request: 0,
  requested: null,
  pending: null,
  error: null,
};

/**
 * Line numbers of `after` whose text a change touched, as [first, last]
 * ranges. A change that only adds or removes whole lines touches just the
 * added lines; anything inside a line touches every line it spans.
 */
export function touchedLines(
  changes: ChangeDesc,
  before: Text,
  after: Text,
): [number, number][] {
  const out: [number, number][] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const aligned =
      before.lineAt(fromA).from === fromA &&
      (toA === fromA || before.lineAt(toA).from === toA) &&
      after.lineAt(fromB).from === fromB &&
      (toB === fromB || after.lineAt(toB).from === toB);
    if (aligned) {
      if (toB > fromB)
        out.push([after.lineAt(fromB).number, after.lineAt(toB - 1).number]);
      return;
    }
    out.push([after.lineAt(fromB).number, after.lineAt(toB).number]);
  });
  return out;
}

function dropTouched(
  marks: RangeSet<CommitMark>,
  lines: [number, number][],
  doc: Text,
): RangeSet<CommitMark> {
  let next = marks;
  for (const [first, last] of lines) {
    next = next.update({
      filterFrom: doc.line(first).from,
      filterTo: doc.line(last).to,
      filter: () => false,
    });
  }
  return next;
}

function marksFor(
  result: Extract<GitBlame, { kind: "ready" }>,
  doc: Text,
): RangeSet<CommitMark> {
  const ranges = [];
  const values = result.commits.map((_, i) => new CommitMark(i));
  for (const hunk of result.hunks) {
    const value = values[hunk.commit];
    if (!value) continue;
    const end = Math.min(hunk.start + hunk.count - 1, doc.lines);
    for (let line = hunk.start; line <= end; line++) {
      ranges.push(value.range(doc.line(line).from));
    }
  }
  return RangeSet.of(ranges, true);
}

function applyLoaded(
  value: BlameField,
  loaded: BlameLoad,
  doc: Text,
): BlameField {
  if (loaded.id !== value.request || !value.requested) return value;
  const base = { ...value, requested: null, pending: null };
  const { result } = loaded;
  if (result.kind === "error")
    return { ...base, status: "error", error: result.message };
  if (result.kind !== "ready") {
    return { ...base, status: result.kind, commits: [], marks: RangeSet.empty };
  }
  let marks = marksFor(result, value.requested);
  if (value.pending && !value.pending.empty) {
    marks = marks.map(value.pending);
    marks = dropTouched(
      marks,
      touchedLines(value.pending, value.requested, doc),
      doc,
    );
  }
  return {
    ...base,
    status: "ready",
    repoRoot: result.repoRoot,
    commits: result.commits,
    marks,
    error: null,
  };
}

export const blameField = StateField.define<BlameField>({
  create: () => EMPTY,
  update(value, tr: Transaction) {
    let next = value;
    if (tr.docChanged) {
      const touched = touchedLines(tr.changes, tr.startState.doc, tr.newDoc);
      next = {
        ...next,
        marks: dropTouched(next.marks.map(tr.changes), touched, tr.newDoc),
        pending: next.pending ? next.pending.compose(tr.changes) : null,
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(blameRequested)) {
        next = {
          ...next,
          status: "loading",
          request: effect.value.id,
          requested: tr.newDoc,
          pending: ChangeSet.empty(tr.newDoc.length),
        };
      } else if (effect.is(blameSkipped)) {
        if (next.status !== "ready")
          next = { ...next, status: effect.value.status };
      } else if (effect.is(blameLoaded)) {
        next = applyLoaded(next, effect.value, tr.newDoc);
      }
    }
    return next;
  },
});

/** The commit that owns 1-based `line`, or null when it was edited since the
 * blame, has none yet, or the field is absent. */
export function commitForLine(
  state: EditorState,
  line: number,
): GitBlameCommit | null {
  const field = state.field(blameField, false);
  if (!field || line < 1 || line > state.doc.lines) return null;
  const from = state.doc.line(line).from;
  let found: GitBlameCommit | null = null;
  field.marks.between(from, from, (at, _to, mark) => {
    if (at !== from) return;
    found = field.commits[mark.commit] ?? null;
    return false;
  });
  return found;
}
