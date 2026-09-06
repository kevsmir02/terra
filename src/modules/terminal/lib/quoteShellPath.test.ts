import { describe, expect, it } from "vitest";

import {
  formatDroppedPaths,
  quoteShellPath,
  relativeToCwd,
} from "./quoteShellPath";

describe("quoteShellPath", () => {
  it("passes a clean path through unquoted so apps can resolve it", () => {
    expect(quoteShellPath("/Users/me/img.png")).toBe("/Users/me/img.png");
  });

  it("quotes a path containing spaces", () => {
    expect(quoteShellPath("/Users/me/My Photos/a.png")).toBe(
      "'/Users/me/My Photos/a.png'",
    );
  });

  it("escapes single quotes inside the path", () => {
    expect(quoteShellPath("/tmp/it's a file")).toBe(`'/tmp/it'\\''s a file'`);
  });

  it("quotes a path with shell metacharacters", () => {
    expect(quoteShellPath("/tmp/$(whoami).png")).toBe("'/tmp/$(whoami).png'");
  });

  it("joins multiple paths with a trailing space", () => {
    expect(formatDroppedPaths(["/a/b.png", "/c/d.png"])).toBe(
      "/a/b.png /c/d.png ",
    );
  });
});

describe("relativeToCwd", () => {
  it("shortens a path under the cwd to its tail", () => {
    expect(relativeToCwd("/ws/src/a.ts", "/ws")).toBe("src/a.ts");
    expect(relativeToCwd("/ws/src/a.ts", "/ws/")).toBe("src/a.ts");
  });

  it("keeps a path outside the cwd absolute", () => {
    expect(relativeToCwd("/other/a.ts", "/ws")).toBe("/other/a.ts");
    expect(relativeToCwd("/ws2/a.ts", "/ws")).toBe("/ws2/a.ts");
  });

  it("keeps the path when no cwd is known", () => {
    expect(relativeToCwd("/ws/a.ts", undefined)).toBe("/ws/a.ts");
    expect(relativeToCwd("/ws/a.ts", "")).toBe("/ws/a.ts");
  });

  it("names the cwd itself as a dot", () => {
    expect(relativeToCwd("/ws", "/ws")).toBe(".");
  });

  it("keeps a tail that would read as a flag absolute", () => {
    expect(relativeToCwd("/ws/-rf", "/ws")).toBe("/ws/-rf");
  });
});

describe("formatDroppedPaths with a cwd", () => {
  it("shortens every path under the cwd and quotes as before", () => {
    expect(formatDroppedPaths(["/ws/a.png", "/ws/My Pics/b.png"], "/ws")).toBe(
      "a.png 'My Pics/b.png' ",
    );
  });
});
