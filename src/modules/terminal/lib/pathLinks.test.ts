import { describe, expect, it } from "vitest";
import { findPathLinks, resolveLinkPath } from "./pathLinks";

function only(text: string) {
  const links = findPathLinks(text);
  expect(links).toHaveLength(1);
  return links[0];
}

describe("findPathLinks", () => {
  it("finds a relative path with line and column", () => {
    const text = "error at src/app/App.tsx:42:7 in foo";
    const link = only(text);
    expect(link).toMatchObject({
      path: "src/app/App.tsx",
      line: 42,
      column: 7,
    });
    expect(text.slice(link.start, link.end)).toBe("src/app/App.tsx:42:7");
  });

  it("finds an absolute path with a line only", () => {
    expect(only("/home/u/x.rs:10")).toMatchObject({
      path: "/home/u/x.rs",
      line: 10,
      column: undefined,
    });
  });

  it("keeps a tilde and a dot prefix on the path", () => {
    expect(only("open ~/notes/a.md")).toMatchObject({ path: "~/notes/a.md" });
    expect(only("open ./src/a.ts")).toMatchObject({ path: "./src/a.ts" });
  });

  it("reads the tsc style file(line,col) suffix", () => {
    const text = "src/a.ts(12,5): error TS2345";
    const link = only(text);
    expect(link).toMatchObject({ path: "src/a.ts", line: 12, column: 5 });
    expect(text.slice(link.start, link.end)).toBe("src/a.ts(12,5)");
  });

  it("reads the python traceback form", () => {
    const text = '  File "src/a.py", line 12, in main';
    const link = only(text);
    expect(link).toMatchObject({ path: "src/a.py", line: 12 });
    expect(text.slice(link.start, link.end)).toBe('src/a.py", line 12');
  });

  it("trims trailing punctuation and quotes", () => {
    expect(only("see src/a.ts.")).toMatchObject({ path: "src/a.ts" });
    expect(only("(src/a.ts)")).toMatchObject({ path: "src/a.ts" });
    expect(only("'src/a.ts',")).toMatchObject({ path: "src/a.ts" });
  });

  it("finds a bare file name with an extension", () => {
    expect(only("Modified README.md")).toMatchObject({ path: "README.md" });
  });

  it("skips urls, directories, versions, and plain words", () => {
    expect(findPathLinks("see https://example.com/a/b.ts now")).toEqual([]);
    expect(findPathLinks("cd src/app/")).toEqual([]);
    expect(findPathLinks("bump to v1.2.3")).toEqual([]);
    expect(findPathLinks("no paths here")).toEqual([]);
  });

  it("finds several links on one line", () => {
    const links = findPathLinks("src/a.ts -> src/b.ts and lib/c.rs:3");
    expect(links.map((l) => l.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "lib/c.rs",
    ]);
  });
});

describe("resolveLinkPath", () => {
  it("keeps an absolute path", () => {
    expect(resolveLinkPath("/a/b.ts", "/ws", "/home/u")).toBe("/a/b.ts");
  });

  it("expands a tilde against home", () => {
    expect(resolveLinkPath("~/n/a.md", "/ws", "/home/u")).toBe(
      "/home/u/n/a.md",
    );
  });

  it("joins a relative path to the cwd and collapses dot segments", () => {
    expect(resolveLinkPath("src/a.ts", "/ws", "/home/u")).toBe("/ws/src/a.ts");
    expect(resolveLinkPath("./src/a.ts", "/ws", "/home/u")).toBe(
      "/ws/src/a.ts",
    );
    expect(resolveLinkPath("../x/a.ts", "/ws/src", "/home/u")).toBe(
      "/ws/x/a.ts",
    );
  });

  it("returns null for a relative path without a cwd", () => {
    expect(resolveLinkPath("src/a.ts", undefined, "/home/u")).toBeNull();
  });
});
