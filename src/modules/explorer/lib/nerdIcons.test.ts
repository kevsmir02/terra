import { describe, expect, it } from "vitest";
import { nerdProvider } from "./nerdIcons";

describe("nerd icon provider", () => {
  it("maps a known extension to its glyph", () => {
    expect(nerdProvider.file("main.ts")).toEqual({ kind: "glyph", char: "", tone: "file" });
  });

  it("walks compound extensions down to the last segment", () => {
    expect(nerdProvider.file("store.test.ts")).toEqual({ kind: "glyph", char: "", tone: "file" });
  });

  it("prefers a full-name match over the extension", () => {
    expect(nerdProvider.file("package.json")).toMatchObject({ char: "" });
    expect(nerdProvider.file(".gitignore")).toMatchObject({ char: "" });
  });

  it("falls back to the generic file glyph", () => {
    expect(nerdProvider.file("weird.zzz")).toEqual({ kind: "glyph", char: "", tone: "file" });
    expect(nerdProvider.file("LICENSE.unknown")).toMatchObject({ char: "" });
  });

  it("distinguishes open and closed folders and tones them as folders", () => {
    expect(nerdProvider.folder("src", false)).toEqual({ kind: "glyph", char: "", tone: "folder" });
    expect(nerdProvider.folder("src", true)).toEqual({ kind: "glyph", char: "", tone: "folder" });
  });
});
