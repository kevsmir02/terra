import { usePreferencesStore } from "@/modules/settings/preferences";
import { useMemo } from "react";

export type TerminalFont = {
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
};

export function useTerminalFont(): TerminalFont {
  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  return useMemo(
    () => ({ fontFamily, fontWeight, fontSize }),
    [fontFamily, fontWeight, fontSize],
  );
}
