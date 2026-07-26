import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "MarkdownPreviewPane.tsx"), "utf8");
const streamdownMatch = src.match(/<Streamdown[\s\S]*?<\/Streamdown>/);
const streamdownJsx = streamdownMatch?.[0] ?? "";

describe("MarkdownPreviewPane Streamdown configuration", () => {
  it("renders complete markdown files in static mode", () => {
    expect(streamdownJsx).toMatch(/mode="static"/);
  });

  it("does not run streaming incomplete-markdown repair for files", () => {
    expect(streamdownJsx).toMatch(/parseIncompleteMarkdown=\{false\}/);
  });
});

// globals.css hides every native scrollbar app-wide, so a bare `overflow-auto`
// region scrolls with no visible affordance. Scrollable panes must use
// <ScrollArea>, which draws its own bar — see GitDiffPane and CommandPalette.
describe("MarkdownPreviewPane scroll affordance", () => {
  it("scrolls the document inside a ScrollArea", () => {
    expect(src).toMatch(/<ScrollArea\b/);
  });

  it("imports ScrollArea from the shared ui component", () => {
    expect(src).toMatch(
      /import \{ ScrollArea \} from "@\/components\/ui\/scroll-area"/,
    );
  });

  it("does not fall back to a bare overflow-auto scroll container", () => {
    expect(src).not.toMatch(/overflow-auto/);
  });
});
