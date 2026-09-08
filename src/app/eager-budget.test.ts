import { describe, expect, it } from "vitest";
import { traceEager } from "../../scripts/eager-graph.mjs";

// Locks the startup-bundle invariant: the heavy editor / AI / markdown stacks
// must stay out of the eager graph of both window entries so they load only
// when the user opens those surfaces. A static import that re-introduces any of
// these (e.g. a barrel re-export of chat runtime, or a `cn`-style util getting
// absorbed into a feature chunk) will fail here. xterm and motion are
// intentionally eager (terminal-first shell) and are not asserted against.
// The Catppuccin icon JSON loads only when a theme selects that set.
const HEAVY = [
  "@ai-sdk",
  "ai",
  "streamdown",
  "@codemirror",
  "@uiw",
  "@iconify-json/catppuccin",
  "mermaid",
  "@streamdown/mermaid",
];

function heavyEagerHits(entry: string): string[] {
  const { hits } = traceEager(entry, HEAVY);
  return [...hits.entries()].map(([pkg, info]) => `${pkg} <- ${info.file}`);
}

describe("startup bundle budget", () => {
  it("main window does not eagerly pull editor/AI/markdown stacks", () => {
    expect(heavyEagerHits("src/main.tsx")).toEqual([]);
  });

  it("settings window does not eagerly pull editor/AI/markdown stacks", () => {
    expect(heavyEagerHits("src/settings/main.tsx")).toEqual([]);
  });
});

// Mermaid is the largest dependency in the tree and only a document with a
// mermaid fence needs it, so even the lazy markdown stack must not import it
// statically: useMermaid loads the plugin behind a dynamic import.
describe("mermaid stays behind the fence check", () => {
  it("markdown stack does not statically import mermaid", () => {
    const { hits } = traceEager("src/modules/markdown/MarkdownStack.tsx", [
      "mermaid",
      "@streamdown/mermaid",
    ]);
    expect([...hits.keys()]).toEqual([]);
  });
});
