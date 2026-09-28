import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffContentResult } from "@/lib/native";

const gitDiffContent =
  vi.fn<(...args: unknown[]) => Promise<GitDiffContentResult>>();

vi.mock("@/lib/native", () => ({
  native: {
    gitDiffContent: (...args: unknown[]) => gitDiffContent(...args),
    gitCommitFileDiff: vi.fn(),
  },
}));

const {
  diffGeneration,
  fetchWorkingDiff,
  getCachedDiff,
  invalidateDiff,
  invalidateRepoDiffs,
  subscribeDiffInvalidation,
  workingDiffKey,
} = await import("./diffCache");

function result(modified: string): GitDiffContentResult {
  return {
    originalContent: "",
    modifiedContent: modified,
    isBinary: false,
    fallbackPatch: "",
    truncated: false,
    tooLarge: false,
    conflict: false,
  };
}

function deferred() {
  let resolve!: (v: GitDiffContentResult) => void;
  const promise = new Promise<GitDiffContentResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let repo = 0;
function freshRepo(): string {
  repo += 1;
  return `/repo${repo}`;
}

beforeEach(() => {
  gitDiffContent.mockReset();
});

describe("diff cache invalidation", () => {
  it("notifies subscribers with the repo root and bumps its generation", () => {
    const root = freshRepo();
    const seen: string[] = [];
    const off = subscribeDiffInvalidation((r) => seen.push(r));
    const before = diffGeneration(root);
    invalidateRepoDiffs(root);
    invalidateDiff(workingDiffKey(root, "a.ts", "-"));
    off();
    invalidateRepoDiffs(root);
    expect(seen).toEqual([root, root]);
    expect(diffGeneration(root)).toBe(before + 3);
  });

  it("never caches a fetch that was in flight across an invalidation", async () => {
    const root = freshRepo();
    const stale = deferred();
    gitDiffContent.mockReturnValueOnce(stale.promise);
    const first = fetchWorkingDiff(root, "a.ts", "-", null);
    invalidateRepoDiffs(root);
    stale.resolve(result("old"));
    await first;
    expect(getCachedDiff(workingDiffKey(root, "a.ts", "-"))).toBeUndefined();
  });

  it("does not join a pre-invalidation flight after the bump", async () => {
    const root = freshRepo();
    const stale = deferred();
    gitDiffContent
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(result("new"));
    const first = fetchWorkingDiff(root, "a.ts", "-", null);
    invalidateRepoDiffs(root);
    const second = fetchWorkingDiff(root, "a.ts", "-", null);
    stale.resolve(result("old"));
    expect((await first).modifiedContent).toBe("old");
    expect((await second).modifiedContent).toBe("new");
    expect(gitDiffContent).toHaveBeenCalledTimes(2);
    expect(
      getCachedDiff(workingDiffKey(root, "a.ts", "-"))?.modifiedContent,
    ).toBe("new");
  });

  it("a forced revalidation skips the cached copy", async () => {
    const root = freshRepo();
    gitDiffContent
      .mockResolvedValueOnce(result("v1"))
      .mockResolvedValueOnce(result("v2"));
    await fetchWorkingDiff(root, "a.ts", "+", null);
    expect(
      (await fetchWorkingDiff(root, "a.ts", "+", null)).modifiedContent,
    ).toBe("v1");
    expect(
      (await fetchWorkingDiff(root, "a.ts", "+", null, true)).modifiedContent,
    ).toBe("v2");
  });

  it("invalidating one repo leaves another repo's diffs cached", async () => {
    const a = freshRepo();
    const b = freshRepo();
    gitDiffContent.mockResolvedValue(result("x"));
    await fetchWorkingDiff(a, "f", "-", null);
    await fetchWorkingDiff(b, "f", "-", null);
    invalidateRepoDiffs(a);
    expect(getCachedDiff(workingDiffKey(a, "f", "-"))).toBeUndefined();
    expect(getCachedDiff(workingDiffKey(b, "f", "-"))).toBeDefined();
  });
});
