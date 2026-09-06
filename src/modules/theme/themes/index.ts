import { DEFAULT_THEME_ID, type Theme } from "../types";
import { gruvbox } from "./gruvbox";
import { kanagawa } from "./kanagawa";
import { kanagawaDragon } from "./kanagawa-dragon";
import { nothing } from "./nothing";
import { rebar } from "./rebar";
import { terraDefault } from "./terra-default";

export { terraDefault, kanagawa, kanagawaDragon, gruvbox, nothing, rebar };

export const BUILTIN: readonly Theme[] = [
  terraDefault,
  nothing,
  rebar,
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
