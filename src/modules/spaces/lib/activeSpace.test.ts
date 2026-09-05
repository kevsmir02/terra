import { describe, expect, it } from "vitest";
import { findActiveSpace, freshTabCwd } from "./activeSpace";
import type { SpaceMeta } from "./store";

function space(over: Partial<SpaceMeta>): SpaceMeta {
  return {
    id: "s1",
    name: "Space",
    root: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("findActiveSpace", () => {
  it("returns the space matching activeId", () => {
    const spaces = [space({ id: "a" }), space({ id: "b" })];
    expect(findActiveSpace(spaces, "b")?.id).toBe("b");
  });

  it("falls back to the first space when activeId is null or unknown", () => {
    const spaces = [space({ id: "a" }), space({ id: "b" })];
    expect(findActiveSpace(spaces, null)?.id).toBe("a");
    expect(findActiveSpace(spaces, "missing")?.id).toBe("a");
  });

  it("returns null when there are no spaces", () => {
    expect(findActiveSpace([], "a")).toBeNull();
  });
});

describe("freshTabCwd", () => {
  it("prefers the restored home", () => {
    expect(freshTabCwd("/home/aj", "/work", "/home/me")).toBe("/home/aj");
  });

  it("falls back to the launch cwd then home", () => {
    expect(freshTabCwd(null, "/work", "/home/me")).toBe("/work");
    expect(freshTabCwd(null, null, "/home/me")).toBe("/home/me");
    expect(freshTabCwd(null, null, null)).toBeNull();
  });
});
