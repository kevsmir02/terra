import { describe, expect, it } from "vitest";
import { syntaxFromAnsi } from "./derive";
import { starterTheme } from "./themeFiles";
import { validateTheme } from "./validateTheme";

describe("starterTheme", () => {
  // A single-variant starter silently hands a light-mode user the dark
  // palette, which is the exact trap THEME.md tells authors to avoid.
  it("defines both variants", () => {
    const t = starterTheme();
    expect(t.variants.light).toBeDefined();
    expect(t.variants.dark).toBeDefined();
  });

  it("declares the same colour keys in both variants", () => {
    const t = starterTheme();
    expect(Object.keys(t.variants.light?.colors ?? {}).sort()).toEqual(
      Object.keys(t.variants.dark?.colors ?? {}).sort(),
    );
  });

  it("ships an ansi palette in both variants so syntax derives immediately", () => {
    const t = starterTheme();
    for (const mode of ["light", "dark"] as const) {
      const v = t.variants[mode];
      expect(v?.terminal?.ansi).toHaveLength(16);
      expect(syntaxFromAnsi(v?.terminal, v?.colors, v?.syntax)).not.toBeNull();
    }
  });

  it("passes its own validator", () => {
    expect(validateTheme(JSON.parse(JSON.stringify(starterTheme()))).ok).toBe(
      true,
    );
  });

  it("uses a unique id per call", () => {
    expect(starterTheme().id).not.toBe(starterTheme().id);
  });
});
