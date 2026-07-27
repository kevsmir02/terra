import { DEFAULT_THEME_ID, type Theme } from "../types";
import { caffeine } from "./caffeine";
import { everforest } from "./everforest";
import { gruvbox } from "./gruvbox";
import { kanagawa } from "./kanagawa";
import { kanagawaDragon } from "./kanagawa-dragon";
import { nord } from "./nord";
import { stardew } from "./stardew";
import { sage } from "./sage";
import { terraDefault } from "./terra-default";
import { tide } from "./tide";
import { tokyoNight } from "./tokyo-night";

const BUILTIN: Theme[] = [
  terraDefault,
  kanagawa,
  kanagawaDragon,
  tokyoNight,
  everforest,
  nord,
  gruvbox,
  tide,
  sage,
  caffeine,
  stardew,
];

const BY_ID = new Map<string, Theme>(BUILTIN.map((t) => [t.id, t]));

export function listBuiltinThemes(): Theme[] {
  return BUILTIN;
}

export function getBuiltinTheme(id: string): Theme | undefined {
  return BY_ID.get(id);
}

export function getDefaultTheme(): Theme {
  return BY_ID.get(DEFAULT_THEME_ID) ?? BUILTIN[0];
}
