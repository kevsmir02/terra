import type { Theme, ThemeMode } from "./types";

export type TerminalFont = {
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
};

// A theme supplies the terminal font as a default, never as an override. Once a
// field has moved off its shipped default the user picked it deliberately, so
// activating a theme must not silently discard that choice.
function prefer<T>(preference: T, fallback: T, fromTheme: T | undefined): T {
  if (preference !== fallback) return preference;
  return fromTheme ?? preference;
}

export function resolveTerminalFont(
  preferences: TerminalFont,
  defaults: TerminalFont,
  theme: Theme,
  mode: ThemeMode,
): TerminalFont {
  const variant =
    theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light;
  const terminal = variant?.terminal;
  return {
    fontFamily: prefer(
      preferences.fontFamily,
      defaults.fontFamily,
      terminal?.fontFamily,
    ),
    fontWeight: prefer(
      preferences.fontWeight,
      defaults.fontWeight,
      terminal?.fontWeight,
    ),
    fontSize: prefer(
      preferences.fontSize,
      defaults.fontSize,
      terminal?.fontSize,
    ),
  };
}
