import { describe, expect, it } from "vitest";
import { resolveTerminalFont, type TerminalFont } from "./resolveTerminalFont";
import type { Theme } from "./types";

const defaults: TerminalFont = {
  fontFamily: "",
  fontWeight: "normal",
  fontSize: 14,
};

function themeWith(terminal: Record<string, unknown>): Theme {
  return {
    id: "custom-theme",
    name: "Custom",
    variants: { dark: { terminal } },
  } as Theme;
}

describe("resolveTerminalFont", () => {
  it("applies theme fonts when every preference is still at its default", () => {
    const theme = themeWith({ fontFamily: "Iosevka", fontSize: 16 });

    expect(resolveTerminalFont(defaults, defaults, theme, "dark")).toEqual({
      fontFamily: "Iosevka",
      fontWeight: "normal",
      fontSize: 16,
    });
  });

  // The whole point of the inversion: a theme is a default, not an override.
  it("keeps a user-chosen value ahead of the theme, field by field", () => {
    const preferences: TerminalFont = {
      fontFamily: "Fira Code",
      fontWeight: "normal",
      fontSize: 18,
    };
    const theme = themeWith({
      fontFamily: "Iosevka",
      fontWeight: "bold",
      fontSize: 16,
    });

    expect(resolveTerminalFont(preferences, defaults, theme, "dark")).toEqual({
      // chosen by the user, so the theme loses
      fontFamily: "Fira Code",
      // still default, so the theme fills it in
      fontWeight: "bold",
      fontSize: 18,
    });
  });

  it("restores preferences when the theme declares no font values", () => {
    const preferences: TerminalFont = {
      fontFamily: "Fira Code",
      fontWeight: "bold",
      fontSize: 18,
    };
    const theme = themeWith({ foreground: "#ffffff" });

    expect(resolveTerminalFont(preferences, defaults, theme, "dark")).toEqual(
      preferences,
    );
  });

  it("uses the same variant fallback order as theme colors", () => {
    const theme = themeWith({ fontWeight: "bold" });

    expect(
      resolveTerminalFont(defaults, defaults, theme, "light").fontWeight,
    ).toBe("bold");
  });

  it("falls back to the preference when the theme value is absent", () => {
    const theme = themeWith({});

    expect(resolveTerminalFont(defaults, defaults, theme, "dark")).toEqual(
      defaults,
    );
  });
});
