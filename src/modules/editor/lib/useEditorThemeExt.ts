import { usePreferencesStore } from "@/modules/settings/preferences";
import { resolveEditorTheme, useTheme } from "@/modules/theme";
import type { Extension } from "@codemirror/state";
import { use, useEffect, useReducer } from "react";
import { editorThemes } from "./themes";

/**
 * Resolves the active CodeMirror theme extension, honoring the "auto" pairing.
 * A preset loads on first use: the very first editor suspends until it lands,
 * and a later switch keeps the current theme until the new one is ready, so
 * an editor is never shown unthemed.
 */
export function useEditorThemeExt(): Extension {
  const pref = usePreferencesStore((s) => s.editorTheme);
  const { activeTheme, resolvedMode } = useTheme();
  const picked = editorThemes.pick(
    resolveEditorTheme(pref, activeTheme, resolvedMode),
  );
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!(picked instanceof Promise)) return;
    let live = true;
    void picked.then(() => {
      if (live) rerender();
    });
    return () => {
      live = false;
    };
  }, [picked]);

  if (!(picked instanceof Promise)) return picked;
  return editorThemes.lastReady() ?? use(picked);
}
