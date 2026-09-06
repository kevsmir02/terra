import { describe, expect, it } from "vitest";
import { getBuiltinTheme, listBuiltinThemes } from "./index";

const builtins = listBuiltinThemes();

describe("built-in themes", () => {
  it.each(builtins.map((t) => [t.id, t] as const))(
    "%s has a kebab-case id and a name",
    (_id, theme) => {
      expect(theme.id).toMatch(/^[a-z0-9][a-z0-9-]{1,63}$/);
      expect(theme.name.trim().length).toBeGreaterThan(0);
    },
  );

  it("has no duplicate ids", () => {
    const ids = builtins.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("indexes every entry by id", () => {
    for (const t of builtins) expect(getBuiltinTheme(t.id)).toBe(t);
  });

  it("declares a 16-slot ANSI palette in both variants, the editor derives from it", () => {
    for (const t of builtins) {
      for (const mode of ["light", "dark"] as const) {
        expect(
          t.variants[mode]?.terminal?.ansi,
          `${t.id}/${mode}`,
        ).toHaveLength(16);
      }
    }
  });
});

// Every builtin, not a hand-kept list. A theme with one variant silently
// serves the wrong palette in the other mode, and the list naming which themes
// to check went stale the moment a theme was added without being added here:
// kanagawa-dragon shipped dark-only past this very file.
describe.each(builtins.map((t) => t.id))("%s", (id) => {
  const theme = getBuiltinTheme(id);

  it("defines both variants so the applied mode never falls back", () => {
    expect(theme?.variants.light?.colors).toBeDefined();
    expect(theme?.variants.dark?.colors).toBeDefined();
  });

  it("covers the same color keys in both variants", () => {
    const light = Object.keys(theme?.variants.light?.colors ?? {}).sort();
    const dark = Object.keys(theme?.variants.dark?.colors ?? {}).sort();
    expect(dark).toEqual(light);
  });
});
