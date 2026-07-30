import { contrast, ensureContrast, isHexColor } from "./oklab";
import {
  STATUS_ROLES,
  SYNTAX_ROLES,
  type StatusRole,
  type StatusTokens,
  type SyntaxPalette,
  type SyntaxRole,
  type TerminalPalette,
  type ThemeColors,
} from "./types";

const SYNTAX_SLOT: Record<Exclude<SyntaxRole, "variable" | "operator">, number> =
  {
    comment: 8, keyword: 5, string: 2, number: 3, constant: 13,
    func: 4, property: 6, gutterFg: 8, type: 14, tag: 1,
    tagBracket: 8, attr: 11, attrValue: 2, heading: 4, link: 6, invalid: 9,
  };

const STATUS_SLOT: Record<StatusRole, number> = {
  added: 2, modified: 3, deleted: 1, renamed: 4,
  warning: 3, conflict: 6, ok: 2,
};

// Comment-weight roles are meant to recede, so they hold the 3:1 tier THEME.md
// already documents for slot 8 instead of the 4.5:1 body-text floor.
const DIM_ROLES: ReadonlySet<string> = new Set([
  "comment",
  "gutterFg",
  "tagBracket",
]);

function floorFor(role: string): number {
  return DIM_ROLES.has(role) ? 3 : 4.5;
}

function pick<T extends string>(
  override: Partial<Record<T, string>> | undefined,
  role: T,
): string | undefined {
  const v = override?.[role];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function syntaxFromAnsi(
  terminal: TerminalPalette | undefined,
  colors: ThemeColors | undefined,
  override: Partial<Record<SyntaxRole, string>> | undefined,
): SyntaxPalette | null {
  const ansi = terminal?.ansi;
  if (!ansi) return null;
  const fg = terminal?.foreground ?? colors?.foreground;
  const bg = colors?.background ?? terminal?.background;
  const out = {} as SyntaxPalette;
  for (const role of SYNTAX_ROLES) {
    const base =
      pick(override, role) ??
      (role === "variable" || role === "operator"
        ? fg
        : ansi[SYNTAX_SLOT[role as keyof typeof SYNTAX_SLOT]]);
    if (base === undefined) return null;
    out[role] =
      isHexColor(base) && isHexColor(bg)
        ? ensureContrast(base, bg, floorFor(role))
        : base;
  }
  return out;
}

export function statusFromAnsi(
  terminal: TerminalPalette | undefined,
  colors: ThemeColors | undefined,
  override: Partial<Record<StatusRole, string>> | undefined,
): StatusTokens | null {
  const ansi = terminal?.ansi;
  if (!ansi) return null;
  const bg = colors?.background ?? terminal?.background;
  const card = colors?.card;
  const out = {} as StatusTokens;
  for (const role of STATUS_ROLES) {
    const base = pick(override, role) ?? ansi[STATUS_SLOT[role]];
    if (base === undefined) return null;
    // Status text lands on the app canvas and on card surfaces both. When the
    // two surfaces sit on opposite sides of the luminance midpoint no single
    // lightness clears both, so the canvas wins as the larger surface.
    let value =
      isHexColor(base) && isHexColor(bg)
        ? ensureContrast(base, bg, 4.5)
        : base;
    if (isHexColor(value) && isHexColor(card)) {
      const withCard = ensureContrast(value, card, 4.5);
      if (!isHexColor(bg) || contrast(withCard, bg) >= 4.5) value = withCard;
    }
    out[role] = value;
  }
  return out;
}
