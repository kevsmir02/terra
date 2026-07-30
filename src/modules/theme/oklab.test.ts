import { describe, expect, it } from "vitest";
import { contrast, ensureContrast, fromOklab, isHexColor, toOklab } from "./oklab";

describe("isHexColor", () => {
  it("accepts 3 and 6 digit hex and rejects everything else", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#1f1f28")).toBe(true);
    expect(isHexColor("rgba(0,0,0,0.5)")).toBe(false);
    expect(isHexColor("oklch(0.5 0.1 200)")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

describe("contrast", () => {
  it("gives 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#3a94c5", "#3a94c5")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrast("#8da101", "#fdf6e3")).toBeCloseTo(
      contrast("#fdf6e3", "#8da101"),
      10,
    );
  });
});

describe("toOklab / fromOklab", () => {
  it("round-trips within one 8-bit step", () => {
    for (const hex of ["#000000", "#ffffff", "#8da101", "#df69ba", "#1f1f28"]) {
      const [L, a, b] = toOklab(hex);
      expect(fromOklab(L, a, b)).toBe(hex);
    }
  });
});

describe("ensureContrast", () => {
  it("returns the input untouched when the floor already holds", () => {
    expect(ensureContrast("#000000", "#ffffff", 4.5)).toBe("#000000");
  });

  it("reaches the floor against a light background by darkening", () => {
    const out = ensureContrast("#8da101", "#fdf6e3", 4.5);
    expect(contrast(out, "#fdf6e3")).toBeGreaterThanOrEqual(4.5);
  });

  it("reaches the floor against a dark background by lightening", () => {
    const out = ensureContrast("#2d4f67", "#1f1f28", 4.5);
    expect(contrast(out, "#1f1f28")).toBeGreaterThanOrEqual(4.5);
  });

  // The whole reason for moving lightness rather than blending toward the
  // foreground: blending desaturates into mud, this keeps the hue. Asserted as
  // hue angle and chroma retention rather than raw a/b, because a darker target
  // is often outside sRGB and the clamp acts as a gamut projection, which shifts
  // a and b while leaving hue intact.
  it("preserves hue and most of the chroma", () => {
    const hue = ([, a, b]: [number, number, number]) =>
      (Math.atan2(b, a) * 180) / Math.PI;
    const chroma = ([, a, b]: [number, number, number]) => Math.hypot(a, b);
    const before = toOklab("#8da101");
    const after = toOklab(ensureContrast("#8da101", "#fdf6e3", 4.5));
    expect(Math.abs(hue(after) - hue(before))).toBeLessThan(2);
    expect(chroma(after) / chroma(before)).toBeGreaterThan(0.75);
  });

  it("keeps everforest string vivid rather than grey", () => {
    // Regression pin on the measured outcome. Blending toward fg produced
    // #677658; lightness-only produces a still-saturated olive.
    const out = ensureContrast("#8da101", "#fdf6e3", 4.5);
    const [, a, b] = toOklab(out);
    expect(Math.hypot(a, b)).toBeGreaterThan(0.05);
  });
});
