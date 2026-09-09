import { describe, expect, it } from "vitest";
import { isTabColor, TAB_COLOR_NAMES, TAB_COLORS, tabAccent } from "./tabColor";

describe("isTabColor", () => {
  it("accepts every palette index", () => {
    for (let i = 0; i < TAB_COLORS.length; i++)
      expect(isTabColor(i)).toBe(true);
  });

  it("rejects anything the palette cannot render", () => {
    expect(isTabColor(-1)).toBe(false);
    expect(isTabColor(TAB_COLORS.length)).toBe(false);
    expect(isTabColor(1.5)).toBe(false);
    expect(isTabColor(Number.NaN)).toBe(false);
    expect(isTabColor("0")).toBe(false);
    expect(isTabColor(undefined)).toBe(false);
    expect(isTabColor(null)).toBe(false);
  });
});

describe("tabAccent", () => {
  it("returns the palette colour for a set tab and null otherwise", () => {
    expect(tabAccent({ color: 0 })).toBe(TAB_COLORS[0]);
    expect(tabAccent({})).toBeNull();
    expect(tabAccent({ color: 99 })).toBeNull();
  });
});

describe("TAB_COLOR_NAMES", () => {
  it("names every palette entry exactly once", () => {
    expect(TAB_COLOR_NAMES).toHaveLength(TAB_COLORS.length);
    expect(new Set(TAB_COLOR_NAMES).size).toBe(TAB_COLORS.length);
  });
});
