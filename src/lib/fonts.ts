// One face for the whole app, chosen for reading comfort. The terminal takes
// the Mono variant so every Nerd icon occupies exactly one cell. Every family
// named here ships in src/assets/fonts (declared in styles/fonts.css); a face
// is parsed only when text renders in it.
export const APP_FONT_FAMILY = '"JetBrainsMono Nerd Font", monospace';
export const TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", monospace';

type BundledFontId = "jetbrains-mono" | "fira-code" | "cascadia-code";
export type TerminalFontId = BundledFontId | "system";

export const BUNDLED_FONTS: ReadonlyArray<{
  id: BundledFontId;
  label: string;
  family: string;
}> = [
  {
    id: "jetbrains-mono",
    label: "JetBrainsMono Nerd Font",
    family: "JetBrainsMono Nerd Font Mono",
  },
  {
    id: "fira-code",
    label: "FiraCode Nerd Font",
    family: "FiraCode Nerd Font Mono",
  },
  {
    id: "cascadia-code",
    label: "CaskaydiaCove Nerd Font",
    family: "CaskaydiaCove Nerd Font Mono",
  },
];

export const DEFAULT_TERMINAL_FONT: TerminalFontId = "jetbrains-mono";

function isTerminalFontId(value: unknown): value is TerminalFontId {
  return (
    value === "system" || BUNDLED_FONTS.some((font) => font.id === value)
  );
}

// A family typed before the picker existed keeps working as the system choice.
export function migrateTerminalFont(
  stored: unknown,
  customFamily: string,
): TerminalFontId {
  if (isTerminalFontId(stored)) return stored;
  return customFamily.trim() ? "system" : DEFAULT_TERMINAL_FONT;
}

export function primaryFamily(stack: string): string {
  return stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

const loadedFamilies = new Map<string, Promise<void>>();

// Resolves once the regular and bold faces of the stack's first family are
// usable, so xterm measures the real cell size instead of a fallback's.
export function ensureTerminalFontLoaded(stack: string): Promise<void> {
  const family = primaryFamily(stack);
  const pending = loadedFamilies.get(family);
  if (pending) return pending;
  const ready =
    typeof document === "undefined" || !document.fonts?.load
      ? Promise.resolve()
      : Promise.allSettled([
          document.fonts.load(`400 14px "${family}"`),
          document.fonts.load(`700 14px "${family}"`),
        ]).then(() => undefined);
  loadedFamilies.set(family, ready);
  return ready;
}

export function resolveFontFamily(userInput: string): string {
  const name = userInput.trim();
  if (!name) return TERMINAL_FONT_FAMILY;
  // A comma means the user gave a full stack; otherwise quote the single family.
  const head = name.includes(",") ? name : `"${name.replace(/['"]/g, "")}"`;
  return `${head}, ${TERMINAL_FONT_FAMILY}`;
}

export function resolveTerminalFont(font: string, customFamily: string): string {
  const bundled = BUNDLED_FONTS.find((candidate) => candidate.id === font);
  if (!bundled) return resolveFontFamily(font === "system" ? customFamily : "");
  if (bundled.id === DEFAULT_TERMINAL_FONT) return TERMINAL_FONT_FAMILY;
  return `"${bundled.family}", ${TERMINAL_FONT_FAMILY}`;
}
