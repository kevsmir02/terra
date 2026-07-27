import { describe, expect, it } from "vitest";
import { ALL_VARS, resolveThemeVars } from "./applyTheme";
import type { Theme } from "./types";

function theme(over: Partial<Theme> = {}): Theme {
  return {
    id: "t",
    name: "T",
    variants: { dark: { colors: { background: "#000" } } },
    ...over,
  };
}

describe("resolveThemeVars", () => {
  it("maps color keys to their CSS variable names", () => {
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: { colors: { background: "#000", mutedForeground: "#888" } },
        },
      }),
      "dark",
    );
    expect(vars).toEqual(
      expect.arrayContaining([
        ["--background", "#000"],
        ["--muted-foreground", "#888"],
      ]),
    );
  });

  it("maps the terminal palette including all 16 ansi slots", () => {
    const ansi = Array.from({ length: 16 }, (_, i) => `#${i}${i}${i}`);
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            terminal: {
              background: "#111",
              ansi: ansi as unknown as never,
            },
          },
        },
      }),
      "dark",
    );
    const names = vars?.map(([n]) => n) ?? [];
    expect(names).toContain("--terminal-background");
    expect(names).toContain("--terminal-ansi-black");
    expect(names).toContain("--terminal-ansi-bright-white");
  });

  it("falls back to the dark variant when the requested mode is missing", () => {
    const vars = resolveThemeVars(
      theme({ variants: { dark: { colors: { background: "#dark" } } } }),
      "light",
    );
    expect(vars).toContainEqual(["--background", "#dark"]);
  });

  it("falls back to the light variant when only light exists", () => {
    const vars = resolveThemeVars(
      theme({ variants: { light: { colors: { background: "#light" } } } }),
      "dark",
    );
    expect(vars).toContainEqual(["--background", "#light"]);
  });

  it("returns null when no variant exists", () => {
    expect(resolveThemeVars(theme({ variants: {} }), "dark")).toBeNull();
  });

  it("omits keys the variant does not set", () => {
    const vars = resolveThemeVars(theme(), "dark");
    const names = vars?.map(([n]) => n) ?? [];
    expect(names).toEqual(["--background"]);
  });

  it("emits only names that ALL_VARS can clear", () => {
    const ansi = Array.from({ length: 16 }, () => "#000");
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            colors: { background: "#000", radius: "0rem", borderStyle: "dotted" },
            terminal: { background: "#000", ansi: ansi as unknown as never },
          },
        },
      }),
      "dark",
    );
    for (const [name] of vars ?? []) expect(ALL_VARS).toContain(name);
  });
});
