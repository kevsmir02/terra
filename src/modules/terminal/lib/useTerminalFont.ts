import { resolveTerminalFont } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useMemo } from "react";

export type TerminalFont = {
  /** Resolved family stack, ready for xterm. */
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
};

export function useTerminalFont(): TerminalFont {
  const font = usePreferencesStore((p) => p.terminalFont);
  const customFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const fontFamily = resolveTerminalFont(font, customFamily);
  return useMemo(
    () => ({ fontFamily, fontWeight, fontSize }),
    [fontFamily, fontWeight, fontSize],
  );
}
