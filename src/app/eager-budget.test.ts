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
  // Fetched on the first terminal search by lazySearch.ts.
  "@xterm/addon-search",
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

// The session manager subscribes to the preferences store when it loads, and
// no server can run before an editor asks for one, so it loads with the editor.
describe("the LSP session manager stays dormant", () => {
  it.each(["src/main.tsx", "src/settings/main.tsx"])(
    "%s does not reach it eagerly",
    (entry) => {
      const { files } = traceEager(entry, []);
      expect(files).toContain(entry);
      expect(files).not.toContain("src/modules/lsp/lib/sessionManager.ts");
    },
  );
});

// Only the active editor theme is needed, and "auto" needs none of the
// presets, so each loads behind its own dynamic import.
describe("editor theme presets load on demand", () => {
  const PRESETS = [
    "@uiw/codemirror-theme-atomone",
    "@uiw/codemirror-theme-aura",
    "@uiw/codemirror-theme-copilot",
    "@uiw/codemirror-theme-github",
    "@uiw/codemirror-theme-gruvbox-dark",
    "@uiw/codemirror-theme-nord",
    "@uiw/codemirror-theme-tokyo-night",
    "@uiw/codemirror-theme-xcode",
  ];

  it.each([
    "src/modules/editor/EditorStack.tsx",
    "src/modules/editor/GitDiffStack.tsx",
  ])("%s does not statically import a preset theme", (entry) => {
    const { hits } = traceEager(entry, PRESETS);
    expect([...hits.keys()]).toEqual([]);
  });
});

// Surfaces a user opens with one gesture: only the shell that offers them may
// sit in the startup graph, never the surface itself.
describe("on-demand panels stay lazy", () => {
  const { files } = traceEager("src/main.tsx", []);

  it("reaches the broadcast wrapper but not the dialog", () => {
    expect(files).toContain("src/modules/terminal/BroadcastInputLazy.tsx");
    expect(files).not.toContain("src/modules/terminal/BroadcastInput.tsx");
  });

  it("reaches the search button but not the open panel", () => {
    expect(files).toContain("src/modules/header/SearchInline.tsx");
    expect(files).not.toContain("src/modules/header/SearchPanel.tsx");
  });

  it("reaches the replace view wrapper but not the view or its engine", () => {
    expect(files).toContain("src/modules/search/SearchViewLazy.tsx");
    expect(files).not.toContain("src/modules/search/SearchView.tsx");
    expect(files).not.toContain("src/modules/search/lib/replace.ts");
    expect(files).not.toContain("src/modules/search/lib/useReplaceSearch.ts");
  });
});

// Desktop alerts are live state of the agents module: the notification
// plugin's client loads with the first one, never at startup.
describe("agent alerts load on demand", () => {
  it("main window does not statically import the notification plugin", () => {
    const { hits } = traceEager("src/main.tsx", [
      "@tauri-apps/plugin-notification",
    ]);
    expect([...hits.keys()]).toEqual([]);
  });
});
