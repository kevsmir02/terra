import { describe, expect, it } from "vitest";
import { validateTheme } from "../validateTheme";
import { getBuiltinTheme, listBuiltinThemes } from "./index";

const builtins = listBuiltinThemes();

describe("built-in themes", () => {
  it.each(builtins.map((t) => [t.id, t] as const))(
    "%s round-trips through validateTheme",
    (_id, theme) => {
      const result = validateTheme(JSON.parse(JSON.stringify(theme)));
      expect(result.ok ? null : result.error).toBeNull();
    },
  );

  it("has no duplicate ids", () => {
    const ids = builtins.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("indexes every entry by id", () => {
    for (const t of builtins) expect(getBuiltinTheme(t.id)).toBe(t);
  });

  it("pairs editor themes only for variants that exist", () => {
    for (const t of builtins) {
      for (const mode of ["light", "dark"] as const) {
        if (t.editorTheme?.[mode]) expect(t.variants[mode]).toBeDefined();
      }
    }
  });
});

describe.each(["stardew"])(
  "%s",
  (id) => {
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
