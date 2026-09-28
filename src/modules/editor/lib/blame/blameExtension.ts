import type { GitBlameCommit } from "@/lib/native";
import { gitIpc } from "@/modules/source-control/lib/gitIpc";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { annotationText, type BlameStatus } from "./blameModel";
import {
  blameField,
  blameLoaded,
  blameRequested,
  blameSkipped,
  commitForLine,
} from "./blameState";

export type OpenBlameCommit = (
  commit: GitBlameCommit,
  repoRoot: string,
) => void;

class BlameWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly commit: GitBlameCommit | null,
    readonly repoRoot: string | null,
    readonly onOpen: OpenBlameCommit,
  ) {
    super();
  }

  override eq(other: BlameWidget): boolean {
    return other.text === this.text && other.commit?.sha === this.commit?.sha;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-terra-blame";
    el.textContent = this.text;
    const { commit, repoRoot } = this;
    if (commit && !commit.uncommitted && repoRoot) {
      el.classList.add("cm-terra-blame-link");
      el.title = `${commit.shortSha} ${commit.summary}\nClick to open this file's diff at the commit`;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.onOpen(commit, repoRoot);
      });
    }
    return el;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function currentLineDecoration(
  state: EditorState,
  onOpen: OpenBlameCommit,
): DecorationSet {
  const field = state.field(blameField, false);
  if (!field) return Decoration.none;
  const line = state.doc.lineAt(state.selection.main.head);
  const commit = commitForLine(state, line.number);
  const text = annotationText(
    field.status,
    commit,
    Math.floor(Date.now() / 1000),
  );
  const widget = new BlameWidget(text, commit, field.repoRoot, onOpen);
  return Decoration.set([
    Decoration.widget({ widget, side: 1 }).range(line.to),
  ]);
}

const blameTheme = EditorView.theme({
  ".cm-terra-blame": {
    marginLeft: "2.5em",
    color: "var(--muted-foreground)",
    opacity: "0.75",
    fontStyle: "italic",
    whiteSpace: "pre",
    userSelect: "none",
  },
  ".cm-terra-blame-link": { cursor: "pointer" },
  ".cm-terra-blame-link:hover": {
    opacity: "1",
    textDecoration: "underline",
  },
});

/** Annotates the cursor's line with the commit that last touched it. */
export function blameExtension(onOpen: OpenBlameCommit): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = currentLineDecoration(view.state, onOpen);
      }
      update(update: ViewUpdate) {
        const fieldChanged =
          update.startState.field(blameField, false) !==
          update.state.field(blameField, false);
        if (update.docChanged || update.selectionSet || fieldChanged) {
          this.decorations = currentLineDecoration(update.state, onOpen);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [blameField, plugin, blameTheme];
}

let nextRequest = 0;

/** Blames the file on disk. The buffer must match the disk when this runs;
 * edits made while it is in flight are mapped onto the result. */
export async function requestBlame(
  view: EditorView,
  path: string,
): Promise<void> {
  if (!view.state.field(blameField, false)) return;
  const id = ++nextRequest;
  view.dispatch({ effects: blameRequested.of({ id }) });
  let result: Parameters<typeof blameLoaded.of>[0]["result"];
  try {
    result = await gitIpc.gitBlame(path);
  } catch (e) {
    result = { kind: "error", message: String(e) };
  }
  if (!view.state.field(blameField, false)) return;
  view.dispatch({ effects: blameLoaded.of({ id, result }) });
}

export function markBlameStatus(view: EditorView, status: BlameStatus): void {
  if (!view.state.field(blameField, false)) return;
  view.dispatch({ effects: blameSkipped.of({ status }) });
}

export function commitAtCursor(
  state: EditorState,
): { commit: GitBlameCommit; repoRoot: string } | null {
  const field = state.field(blameField, false);
  if (!field?.repoRoot) return null;
  const commit = commitForLine(
    state,
    state.doc.lineAt(state.selection.main.head).number,
  );
  return commit && !commit.uncommitted
    ? { commit, repoRoot: field.repoRoot }
    : null;
}
