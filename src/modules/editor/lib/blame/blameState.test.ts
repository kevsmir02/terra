import { describe, expect, it } from "vitest";
import type { GitBlame, GitBlameCommit } from "@/lib/native";
import { EditorState, Text } from "@codemirror/state";
import {
  blameField,
  blameLoaded,
  blameRequested,
  blameSkipped,
  commitForLine,
  touchedLines,
} from "./blameState";

function commit(sha: string, extra: Partial<GitBlameCommit> = {}) {
  return {
    sha: sha.repeat(40),
    shortSha: sha.repeat(7),
    author: "Ada",
    authorEmail: "ada@x.dev",
    authorTime: 0,
    summary: sha,
    filename: "f.txt",
    previousSha: null,
    previousFilename: null,
    boundary: false,
    uncommitted: false,
    ...extra,
  } satisfies GitBlameCommit;
}

const A = commit("a");
const B = commit("b");

/** Lines 1-2 from A, line 3 from B. */
const READY: GitBlame = {
  kind: "ready",
  repoRoot: "/repo",
  commits: [A, B],
  hunks: [
    { start: 1, count: 2, commit: 0 },
    { start: 3, count: 1, commit: 1 },
  ],
};

function loaded(doc = "one\ntwo\nthree", result: GitBlame = READY) {
  let state = EditorState.create({ doc, extensions: blameField });
  state = state.update({ effects: blameRequested.of({ id: 1 }) }).state;
  return state.update({ effects: blameLoaded.of({ id: 1, result }) }).state;
}

function owners(state: EditorState): (string | null)[] {
  const out = [];
  for (let n = 1; n <= state.doc.lines; n++)
    out.push(commitForLine(state, n)?.summary ?? null);
  return out;
}

describe("blame field", () => {
  it("attributes every line of a ready blame", () => {
    expect(owners(loaded())).toEqual(["a", "a", "b"]);
  });

  it("marks only a typed-in line as uncommitted", () => {
    const state = loaded();
    const next = state.update({ changes: { from: 5, insert: "X" } }).state;
    expect(owners(next)).toEqual(["a", null, "b"]);
  });

  it("keeps the owner of a line a new line was inserted above", () => {
    const state = loaded();
    const next = state.update({ changes: { from: 4, insert: "new\n" } }).state;
    expect(owners(next)).toEqual(["a", null, "a", "b"]);
  });

  it("keeps the next line's owner when a whole line is deleted", () => {
    const state = loaded();
    const next = state.update({ changes: { from: 4, to: 8 } }).state;
    expect(owners(next)).toEqual(["a", "b"]);
  });

  it("marks a joined line as uncommitted", () => {
    const state = loaded();
    const next = state.update({ changes: { from: 7, to: 8 } }).state;
    expect(owners(next)).toEqual(["a", null]);
  });

  it("maps a blame that lands after edits made while it was in flight", () => {
    let state = EditorState.create({
      doc: "one\ntwo\nthree",
      extensions: blameField,
    });
    state = state.update({ effects: blameRequested.of({ id: 1 }) }).state;
    state = state.update({ changes: { from: 0, insert: "zero\n" } }).state;
    state = state.update({
      effects: blameLoaded.of({ id: 1, result: READY }),
    }).state;
    expect(owners(state)).toEqual([null, "a", "a", "b"]);
  });

  it("ignores a stale response once a newer request is out", () => {
    let state = EditorState.create({ doc: "one", extensions: blameField });
    state = state.update({ effects: blameRequested.of({ id: 1 }) }).state;
    state = state.update({ effects: blameRequested.of({ id: 2 }) }).state;
    state = state.update({
      effects: blameLoaded.of({ id: 1, result: READY }),
    }).state;
    expect(state.field(blameField).status).toBe("loading");
    expect(owners(state)).toEqual([null]);
  });

  it("drops every mark when the whole document is replaced", () => {
    const state = loaded();
    const next = state.update({
      changes: { from: 0, to: state.doc.length, insert: "one\ntwo\nthree" },
    }).state;
    expect(owners(next)).toEqual([null, null, null]);
  });

  it("clamps a hunk that runs past the end of the document", () => {
    const state = loaded("one", READY);
    expect(owners(state)).toEqual(["a"]);
  });

  it("reports outcomes and errors as the status, with no commits", () => {
    expect(loaded("x", { kind: "untracked" }).field(blameField).status).toBe(
      "untracked",
    );
    let state = EditorState.create({ doc: "x", extensions: blameField });
    state = state.update({ effects: blameRequested.of({ id: 1 }) }).state;
    state = state.update({
      effects: blameLoaded.of({
        id: 1,
        result: { kind: "error", message: "boom" },
      }),
    }).state;
    expect(state.field(blameField)).toMatchObject({
      status: "error",
      error: "boom",
    });
  });

  it("a skip never overrides a ready blame", () => {
    const state = loaded().update({
      effects: blameSkipped.of({ status: "dirty" }),
    }).state;
    expect(state.field(blameField).status).toBe("ready");
  });

  it("answers null without the field", () => {
    const bare = EditorState.create({ doc: "x" });
    expect(commitForLine(bare, 1)).toBeNull();
  });
});

describe("touchedLines", () => {
  const before = Text.of(["one", "two", "three"]);
  function touched(change: { from: number; to?: number; insert?: string }) {
    const state = EditorState.create({ doc: before });
    const tr = state.update({ changes: change });
    return touchedLines(tr.changes, before, tr.newDoc);
  }

  it("counts a pasted block of whole lines as only those lines", () => {
    expect(touched({ from: 4, insert: "x\ny\n" })).toEqual([[2, 3]]);
  });

  it("counts an edit inside a line as that line", () => {
    expect(touched({ from: 5, to: 6, insert: "W" })).toEqual([[2, 2]]);
  });

  it("counts nothing for a removed whole line", () => {
    expect(touched({ from: 4, to: 8 })).toEqual([]);
  });
});
