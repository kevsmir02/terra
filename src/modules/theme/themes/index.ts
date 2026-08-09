import { DEFAULT_THEME_ID, type Theme } from "../types";
import { gameboy } from "./gameboy";
import { gruvbox } from "./gruvbox";
import { kanagawa } from "./kanagawa";
import { kanagawaDragon } from "./kanagawa-dragon";
import { nothing } from "./nothing";
import { stardew } from "./stardew";
import { terraDefault } from "./terra-default";

export { terraDefault, stardew, gameboy, kanagawa, kanagawaDragon, gruvbox, nothing };

export const BUILTIN: readonly Theme[] = [
  terraDefault,
  nothing,
  stardew,
  gameboy,
  kanagawa,
  kanagawaDragon,
  gruvbox,
];

const BY_ID = new Map<string, Theme>(BUILTIN.map((t) => [t.id, t]));

export function listBuiltinThemes(): Theme[] {
  return BUILTIN as Theme[];
}

export function getBuiltinTheme(id: string): Theme | undefined {
  return BY_ID.get(id);
}

export function getDefaultTheme(): Theme {
  return BY_ID.get(DEFAULT_THEME_ID) ?? BUILTIN[0];
}
