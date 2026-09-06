import { usePreferencesStore } from "@/modules/settings/preferences";
import { resolveEditorTheme, useTheme } from "@/modules/theme";
import type { Extension } from "@codemirror/state";
import { useMemo } from "react";
import { derivedDark, derivedLight } from "./cmThemes";
import { EDITOR_THEME_EXT } from "./themes";

/** Resolves the active CodeMirror theme extension, honoring the "auto" pairing. */
export function useEditorThemeExt(): Extension {
  const pref = usePreferencesStore((s) => s.editorTheme);
  const { activeTheme, resolvedMode } = useTheme();
  return useMemo(() => {
    const r = resolveEditorTheme(pref, activeTheme, resolvedMode);
    if (r.kind === "derived") {
      return r.mode === "dark" ? derivedDark : derivedLight;
    }
    return EDITOR_THEME_EXT[r.id] ?? EDITOR_THEME_EXT.atomone;
  }, [pref, activeTheme, resolvedMode]);
}
