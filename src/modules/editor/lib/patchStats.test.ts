import { describe, expect, it } from "vitest";
import { patchStats } from "./patchStats";

const header = [
  "diff --git a/notes.md b/notes.md",
  "index 1111111..2222222 100644",
  "--- a/notes.md",
  "+++ b/notes.md",
];

function patch(...lines: string[]): string {
  return `${[...header, ...lines].join("\n")}\n`;
}

describe("patchStats", () => {
  it("counts nothing for an empty patch or one with only file headers", () => {
    expect(patchStats("")).toEqual({ added: 0, removed: 0 });
    expect(patchStats(`${header.join("\n")}\n`)).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("counts a removed markdown bullet and an added line starting with +", () => {
    const p = patch("@@ -1,2 +1,2 @@", " # Title", "-- item", "++1 vote");
    expect(patchStats(p)).toEqual({ added: 1, removed: 1 });
  });

  it("counts removed flags and added separators that look like file headers", () => {
    const p = patch(
      "@@ -1,3 +1,3 @@",
      "---verbose",
      "--- a/looks-like-a-header",
      "+++ b/looks-like-a-header",
      "+++",
      " tail",
    );
    expect(patchStats(p)).toEqual({ added: 2, removed: 2 });
  });

  it("never counts the first character of the patch outside a hunk", () => {
    expect(patchStats("+not a line\n-nor this\n")).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("stops a hunk at its declared length so the next file header is not counted", () => {
    const p = [
      ...header,
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
      "",
    ].join("\n");
    expect(patchStats(p)).toEqual({ added: 3, removed: 1 });
  });

  it("skips the no-newline marker and keeps counting", () => {
    const p = patch(
      "@@ -1 +1,2 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "+more",
    );
    expect(patchStats(p)).toEqual({ added: 2, removed: 1 });
  });

  it("treats a blank line inside a hunk as stripped context", () => {
    const p = patch("@@ -1,3 +1,3 @@", " a", "", "-b", "+c");
    expect(patchStats(p)).toEqual({ added: 1, removed: 1 });
  });

  it("reads a combined conflict diff with two parent columns", () => {
    const p = [
      "diff --cc f.txt",
      "index 1,1..0000000",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@@ -1,1 -1,1 +1,5 @@@",
      "++<<<<<<< HEAD",
      " +ours",
      "++=======",
      "+ theirs",
      "++>>>>>>> side",
      "",
    ].join("\n");
    expect(patchStats(p)).toEqual({ added: 5, removed: 0 });
  });

  it("ignores a malformed hunk header", () => {
    expect(patchStats(patch("@@ nonsense @@", "+x", "-y"))).toEqual({
      added: 0,
      removed: 0,
    });
  });
});
