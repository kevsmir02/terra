import type { GitChangedFile } from "@/lib/native";
import { describe, expect, it } from "vitest";
import { stepChangedFile, stepReplaces } from "./reviewNav";

describe("stepReplaces", () => {
  it("closes a diff the stepper opened", () => {
    expect(stepReplaces({ id: 3, preview: true }, 4)).toBe(true);
  });

  it("keeps a diff the user opened on purpose", () => {
    expect(stepReplaces({ id: 3, preview: false }, 4)).toBe(false);
    expect(stepReplaces({ id: 3 }, 4)).toBe(false);
  });

  it("never closes the tab it lands on or a missing origin", () => {
    expect(stepReplaces({ id: 3, preview: true }, 3)).toBe(false);
    expect(stepReplaces(null, 4)).toBe(false);
  });
});

function file(
  path: string,
  flags: Partial<GitChangedFile> = {},
): GitChangedFile {
  return {
    path,
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    statusLabel: "Modified",
    ...flags,
  };
}

const files = [
  file("a.ts"),
  file("b.ts", { staged: true, unstaged: false }),
  file("c.ts", { staged: true, unstaged: true }),
];

describe("stepChangedFile", () => {
  it("returns nothing for a clean tree", () => {
    expect(stepChangedFile([], null, 1)).toBeNull();
  });

  it("starts at the first row forward and the last row back", () => {
    expect(stepChangedFile(files, null, 1)?.path).toBe("a.ts");
    expect(stepChangedFile(files, null, -1)?.path).toBe("c.ts");
  });

  it("opens the unstaged side when a file has one, as the list does", () => {
    expect(stepChangedFile(files, { path: "a.ts", mode: "-" }, 1)).toEqual({
      path: "b.ts",
      mode: "+",
      originalPath: null,
    });
    expect(stepChangedFile(files, { path: "b.ts", mode: "+" }, 1)?.mode).toBe(
      "-",
    );
  });

  it("finds the current file whichever side is open", () => {
    expect(stepChangedFile(files, { path: "c.ts", mode: "+" }, -1)?.path).toBe(
      "b.ts",
    );
  });

  it("stops at either end instead of wrapping", () => {
    expect(stepChangedFile(files, { path: "c.ts", mode: "-" }, 1)).toBeNull();
    expect(stepChangedFile(files, { path: "a.ts", mode: "-" }, -1)).toBeNull();
  });

  it("counts a path listed twice once", () => {
    const dup = [file("a.ts"), file("a.ts", { staged: true }), file("z.ts")];
    expect(stepChangedFile(dup, { path: "a.ts", mode: "-" }, 1)?.path).toBe(
      "z.ts",
    );
  });

  it("starts over from the edge when the current file left the list", () => {
    expect(
      stepChangedFile(files, { path: "gone.ts", mode: "-" }, 1)?.path,
    ).toBe("a.ts");
  });
});
