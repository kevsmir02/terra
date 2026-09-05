export const MOD_KEY = "Ctrl";
export const KEY_SEP = "+";

export function fmtShortcut(...parts: string[]): string {
  return parts.join(KEY_SEP);
}
