import { DEFAULT_THEME_ID, type Theme } from "../types";
import { caffeine } from "./caffeine";
import { everforest } from "./everforest";
import { gameboy } from "./gameboy";
import { gruvbox } from "./gruvbox";
import { kanagawa } from "./kanagawa";
import { kanagawaDragon } from "./kanagawa-dragon";
import { nord } from "./nord";
import { nothing } from "./nothing";
import { sage } from "./sage";
import { stardew } from "./stardew";
import { terraDefault } from "./terra-default";
import { tide } from "./tide";
import { tokyoNight } from "./tokyo-night";

export {
  terraDefault,
  stardew,
  gameboy,
  kanagawa,
  kanagawaDragon,
  everforest,
  gruvbox,
  tokyoNight,
  nord,
  caffeine,
  sage,
  tide,
  nothing,
};

export const BUILTIN: readonly Theme[] = [
  terraDefault,
  nothing,
  stardew,
  gameboy,
  kanagawa,
  kanagawaDragon,
  everforest,
  gruvbox,
  tokyoNight,
  nord,
  caffeine,
  sage,
  tide,
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
