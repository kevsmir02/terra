import { usePreferencesStore } from "@/modules/settings/preferences";
import { DEFAULT_PREFERENCES } from "@/modules/settings/store";
import { resolveTerminalFont, useTheme } from "@/modules/theme";
import { useMemo } from "react";

const FONT_DEFAULTS = {
  fontFamily: DEFAULT_PREFERENCES.terminalFontFamily,
  fontWeight: DEFAULT_PREFERENCES.terminalFontWeight,
  fontSize: DEFAULT_PREFERENCES.terminalFontSize,
};

export function useTerminalFont() {
  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const { activeTheme, resolvedMode } = useTheme();

  return useMemo(
    () =>
      resolveTerminalFont(
        { fontFamily, fontWeight, fontSize },
        FONT_DEFAULTS,
        activeTheme,
        resolvedMode,
      ),
    [fontFamily, fontWeight, fontSize, activeTheme, resolvedMode],
  );
}
