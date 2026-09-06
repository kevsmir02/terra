import { resolveVariant } from "./resolveVariant";
import type { Theme, ThemeMode } from "./types";

export function wallpaperAllowed(
  theme: Theme,
  mode: ThemeMode,
  prefs: { active: boolean },
): boolean {
  if (!prefs.active) return false;
  const resolved = resolveVariant(theme, mode);
  return resolved?.variant.effects?.wallpaper !== false;
}
