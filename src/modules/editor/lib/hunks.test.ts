import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { chunkAt, chunkToHunk, hunkActionsFor } from "./hunks";

function doc(s: string): Text {
  return Text.of(s.split("\n"));
}

function hunks(a: string, b: string) {
  const ta = doc(a);
  const tb = doc(b);
  return Chunk.build(ta, tb).map((c) => chunkToHunk(ta, tb, c));
}

/** Applies a hunk the way the backend does, in the same line model. */
function splice(a: string, b: string, h: ReturnType<typeof hunks>[number]) {
  const lines = a.split("\n");
  const other = b.split("\n");
  lines.splice(
    h.oldFrom,
    h.oldLines.length,
    ...other.slice(h.newFrom, h.newFrom + h.newLines.length),
  );
  return lines.join("\n");
}

describe("chunkToHunk", () => {
  it("maps an edited line to its lines on both sides", () => {
    expect(hunks("l1\nl2\nl3\n", "l1\nL2\nl3\n")).toEqual([
      { oldFrom: 1, oldLines: ["l2"], newFrom: 1, newLines: ["L2"] },
    ]);
  });

  it.each([
    ["", "x\ny\n"],
    ["a\nb", "a\nb\n"],
    ["a\nb\n", "a\nb"],
    ["a", "a\nb"],
    ["a\nb\n", ""],
    ["a\nb\nc", "a\nB\nc"],
  ])("rebuilds %j into %j when its only hunk is applied", (a, b) => {
    const [h] = hunks(a, b);
    expect(splice(a, b, h)).toBe(b);
  });

  it("applies one of two hunks and leaves the other", () => {
    const a = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
    const b = "1\nX\n3\n4\n5\n6\n7\n8\nY\n10\n";
    const [first, second] = hunks(a, b);
    expect(splice(a, b, first)).toBe("1\nX\n3\n4\n5\n6\n7\n8\n9\n10\n");
    expect(splice(a, b, second)).toBe("1\n2\n3\n4\n5\n6\n7\n8\nY\n10\n");
  });

  it("places an insertion after the last line at the end", () => {
    const [h] = hunks("a", "a\nb");
    expect(h.oldFrom + h.oldLines.length).toBeLessThanOrEqual(1);
  });
});

describe("chunkAt", () => {
  const chunks = [
    { fromB: 3, toB: 6 },
    { fromB: 10, toB: 10 },
  ];

  it("finds the chunk holding the cursor", () => {
    expect(chunkAt(chunks, 3)).toBe(0);
    expect(chunkAt(chunks, 5)).toBe(0);
  });

  it("treats a deletion as current only at its anchor", () => {
    expect(chunkAt(chunks, 10)).toBe(1);
    expect(chunkAt(chunks, 11)).toBe(-1);
  });

  it("finds nothing between chunks", () => {
    expect(chunkAt(chunks, 6)).toBe(-1);
    expect(chunkAt([], 0)).toBe(-1);
  });
});

describe("hunkActionsFor", () => {
  it("never offers discard on the staged side", () => {
    expect(hunkActionsFor("+")).toEqual({ primary: "unstage", discard: false });
    expect(hunkActionsFor("-")).toEqual({ primary: "stage", discard: true });
  });
});
