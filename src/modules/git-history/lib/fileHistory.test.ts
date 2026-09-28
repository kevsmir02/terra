import { describe, expect, it } from "vitest";
import type { GitLogEntry } from "@/lib/native";
import { fileAtCommit, historyLookupDir } from "./fileHistory";

function row(path: string | null, originalPath: string | null = null) {
  return { path, originalPath } as GitLogEntry;
}

describe("fileAtCommit", () => {
  it("uses a row's own name and its pre-rename name", () => {
    const entries = [row("new.txt", "old.txt")];
    expect(fileAtCommit(entries, 0)).toEqual({
      path: "new.txt",
      originalPath: "old.txt",
    });
  });

  it("names a merge after the newer row's pre-rename name", () => {
    const entries = [row("new.txt", "old.txt"), row(null), row("old.txt")];
    expect(fileAtCommit(entries, 1)).toEqual({
      path: "old.txt",
      originalPath: null,
    });
  });

  it("falls back to the older row when nothing newer has a name", () => {
    const entries = [row(null), row(null), row("f.txt")];
    expect(fileAtCommit(entries, 0)).toEqual({
      path: "f.txt",
      originalPath: null,
    });
  });

  it("returns null with no name anywhere or out of range", () => {
    expect(fileAtCommit([row(null)], 0)).toBeNull();
    expect(fileAtCommit([row("a")], 3)).toBeNull();
  });
});

describe("historyLookupDir", () => {
  it("resolves a file from its parent and a directory from itself", () => {
    expect(historyLookupDir("/repo/src/a.ts", false)).toBe("/repo/src");
    expect(historyLookupDir("/repo/src/", true)).toBe("/repo/src");
    expect(historyLookupDir("/a.ts", false)).toBe("/");
    expect(historyLookupDir("/", true)).toBe("/");
  });
});
