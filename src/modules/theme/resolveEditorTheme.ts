import {
  EDITOR_THEME_AUTO,
  isEditorThemeId,
  type EditorThemeId,
  type EditorThemePref,
} from "@/modules/settings/store";
import { resolveVariant } from "./resolveVariant";
import type { Theme } from "./types";

const FALLBACK: Record<"light" | "dark", EditorThemeId> = {
  light: "github-light",
  dark: "atomone",
};

export type EditorThemeResolution =
  | { kind: "derived"; mode: "light" | "dark" }
  | { kind: "preset"; id: EditorThemeId };

/**
 * Resolves what the editor should render. In "auto" a theme that can derive a
 * syntax palette from its own ansi colours does so, which is what makes the
 * editor match the theme instead of a hand-picked third-party pairing.
 */
export function resolveEditorTheme(
  pref: EditorThemePref,
  theme: Theme,
  mode: "light" | "dark",
): EditorThemeResolution {
  if (pref !== EDITOR_THEME_AUTO) return { kind: "preset", id: pref };
  const resolved = resolveVariant(theme, mode);
  if (resolved) {
    const { variant } = resolved;
    if (variant.terminal?.ansi) {
      return { kind: "derived", mode: resolved.mode };
    }
  }
  const mapped =
    theme.editorTheme?.[mode] ??
    theme.editorTheme?.dark ??
    theme.editorTheme?.light;
  return {
    kind: "preset",
    id: isEditorThemeId(mapped) ? mapped : FALLBACK[mode],
  };
}
