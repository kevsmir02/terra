import type { Theme, ThemeMode, ThemeVariant } from "./types";

export type ResolvedVariant = { variant: ThemeVariant; mode: ThemeMode };

/**
 * Reports which variant supplies a theme's values and which mode it came from.
 * The second field matters because a single-variant theme renders its one
 * palette in both modes, so the editor must follow the variant, not the request.
 */
export function resolveVariant(
  theme: Theme,
  mode: ThemeMode,
): ResolvedVariant | null {
  const exact = theme.variants[mode];
  if (exact) return { variant: exact, mode };
  const dark = theme.variants.dark;
  if (dark) return { variant: dark, mode: "dark" };
  const light = theme.variants.light;
  if (light) return { variant: light, mode: "light" };
  return null;
}
