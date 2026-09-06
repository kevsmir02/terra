import { describe, expect, it } from "vitest";
import type { Theme } from "./types";
import { wallpaperAllowed } from "./wallpaper";

const accepting: Theme = {
  id: "a",
  name: "A",
  variants: {
    dark: { colors: { background: "#000" } },
    light: { colors: { background: "#fff" } },
  },
};
const declining: Theme = {
  id: "d",
  name: "D",
  variants: {
    dark: { colors: { background: "#000" }, effects: { wallpaper: false } },
    light: { colors: { background: "#fff" } },
  },
};

describe("wallpaperAllowed", () => {
  it("is false when the preference is off, whatever the theme says", () => {
    expect(wallpaperAllowed(accepting, "dark", { active: false })).toBe(false);
  });

  it("is true when the preference is on and the theme does not decline", () => {
    expect(wallpaperAllowed(accepting, "dark", { active: true })).toBe(true);
  });

  it("is false when the active variant declines", () => {
    expect(wallpaperAllowed(declining, "dark", { active: true })).toBe(false);
  });

  it("follows the variant that actually renders", () => {
    expect(wallpaperAllowed(declining, "light", { active: true })).toBe(true);
    const darkOnly: Theme = {
      id: "x",
      name: "X",
      variants: { dark: { effects: { wallpaper: false } } },
    };
    expect(wallpaperAllowed(darkOnly, "light", { active: true })).toBe(false);
  });
});
