// One face for the whole app, chosen for reading comfort. The terminal takes
// the Mono variant so every Nerd icon occupies exactly one cell.
export const APP_FONT_FAMILY = '"JetBrainsMono Nerd Font", monospace';
export const TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", monospace';

let monoReady: Promise<void> | null = null;

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  if (typeof document === "undefined" || !document.fonts?.load) {
    monoReady = Promise.resolve();
    return monoReady;
  }
  monoReady = Promise.allSettled([
    document.fonts.load('400 14px "JetBrainsMono Nerd Font Mono"'),
    document.fonts.load('700 14px "JetBrainsMono Nerd Font Mono"'),
  ]).then(() => undefined);
  return monoReady;
}

export function resolveFontFamily(userInput: string): string {
  const name = userInput.trim();
  if (!name) return TERMINAL_FONT_FAMILY;
  // A comma means the user gave a full stack; otherwise quote the single family.
  const head = name.includes(",") ? name : `"${name.replace(/['"]/g, "")}"`;
  return `${head}, ${TERMINAL_FONT_FAMILY}`;
}
