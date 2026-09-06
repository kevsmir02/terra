import {
  EDITOR_THEME_AUTO,
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
 * In "auto" a theme derives its syntax palette from its own ansi colours. Every
 * builtin declares one, so the preset fallback only covers a theme without.
 */
export function resolveEditorTheme(
  pref: EditorThemePref,
  theme: Theme,
  mode: "light" | "dark",
): EditorThemeResolution {
  if (pref !== EDITOR_THEME_AUTO) return { kind: "preset", id: pref };
  const resolved = resolveVariant(theme, mode);
  if (resolved?.variant.terminal?.ansi) {
    return { kind: "derived", mode: resolved.mode };
  }
  return { kind: "preset", id: FALLBACK[mode] };
}
