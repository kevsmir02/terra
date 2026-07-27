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

describe("organic", () => {
  const organic = getBuiltinTheme("organic");

  it("defines both variants so the applied mode never falls back", () => {
    expect(organic?.variants.light?.colors).toBeDefined();
    expect(organic?.variants.dark?.colors).toBeDefined();
  });

  it("covers the same color keys in both variants", () => {
    const light = Object.keys(organic?.variants.light?.colors ?? {}).sort();
    const dark = Object.keys(organic?.variants.dark?.colors ?? {}).sort();
    expect(dark).toEqual(light);
  });
});
