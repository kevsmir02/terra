import { describe, expect, it } from "vitest";
import type { GitBlameCommit } from "@/lib/native";
import {
  annotationText,
  commitFileTarget,
  NOT_COMMITTED,
  relativeTime,
} from "./blameModel";

const NOW = 1_700_000_000;

function commit(extra: Partial<GitBlameCommit> = {}): GitBlameCommit {
  return {
    sha: "a".repeat(40),
    shortSha: "aaaaaaa",
    author: "Ada",
    authorEmail: "ada@x.dev",
    authorTime: NOW - 3 * 24 * 3600,
    summary: "fix the thing",
    filename: "src/new.ts",
    previousSha: null,
    previousFilename: null,
    boundary: false,
    uncommitted: false,
    ...extra,
  };
}

describe("relativeTime", () => {
  it("picks the largest whole unit and pluralizes", () => {
    expect(relativeTime(NOW - 30, NOW)).toBe("just now");
    expect(relativeTime(NOW - 60, NOW)).toBe("1 minute ago");
    expect(relativeTime(NOW - 2 * 3600, NOW)).toBe("2 hours ago");
    expect(relativeTime(NOW - 400 * 24 * 3600, NOW)).toBe("1 year ago");
  });

  it("treats a future timestamp (clock skew) as just now", () => {
    expect(relativeTime(NOW + 500, NOW)).toBe("just now");
  });
});

describe("annotationText", () => {
  it("names author, age, summary and short sha", () => {
    expect(annotationText("ready", commit(), NOW)).toBe(
      "Ada, 3 days ago · fix the thing · aaaaaaa",
    );
  });

  it("says a line is not committed for the zero commit and for edits", () => {
    expect(annotationText("ready", commit({ uncommitted: true }), NOW)).toBe(
      NOT_COMMITTED,
    );
    expect(annotationText("ready", null, NOW)).toBe(NOT_COMMITTED);
    expect(annotationText("untracked", null, NOW)).toBe(NOT_COMMITTED);
  });

  it("stands the state in for a missing commit", () => {
    expect(annotationText("loading", null, NOW)).toMatch(/Loading/);
    expect(annotationText("tooLarge", null, NOW)).toMatch(/4 MB/);
    expect(annotationText("dirty", null, NOW)).toMatch(/Save/);
  });
});

describe("commitFileTarget", () => {
  it("opens the file under its name in that commit", () => {
    expect(commitFileTarget(commit())).toEqual({
      path: "src/new.ts",
      originalPath: null,
    });
  });

  it("carries the parent-side name when the commit renamed the file", () => {
    expect(
      commitFileTarget(commit({ previousFilename: "src/old.ts" })),
    ).toEqual({ path: "src/new.ts", originalPath: "src/old.ts" });
    expect(
      commitFileTarget(commit({ previousFilename: "src/new.ts" })),
    ).toEqual({ path: "src/new.ts", originalPath: null });
  });

  it("has nothing to open for an uncommitted line", () => {
    expect(commitFileTarget(commit({ uncommitted: true }))).toBeNull();
  });
});
