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

  it("maps shape tokens to their CSS variable names", () => {
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            shape: {
              frameWidth: "8px",
              frameRadius: "0px",
              framePadding: "4px",
              chromeWidth: "6px",
              panelWidth: "4px",
              slotWidth: "4px",
              controlWidth: "3px",
              bevelWidth: "4px",
              bevelOuter: "#8a5a2e",
              bevelMid: "#6b4226",
              bevelInner: "#4a2d16",
              liftColor: "#2a1a0d",
              liftDepth: "6px",
              spacing: "0.3rem",
            },
          },
        },
      }),
      "dark",
    );
    expect(vars).toEqual(
      expect.arrayContaining([
        ["--frame-border-width", "8px"],
        ["--frame-radius", "0px"],
        ["--frame-padding", "4px"],
        ["--chrome-border-width", "6px"],
        ["--panel-border-width", "4px"],
        ["--slot-border-width", "4px"],
        ["--control-border-width", "3px"],
        ["--bevel-width", "4px"],
        ["--bevel-outer", "#8a5a2e"],
        ["--bevel-mid", "#6b4226"],
        ["--bevel-inner", "#4a2d16"],
        ["--lift-color", "#2a1a0d"],
        ["--lift-depth", "6px"],
        ["--ui-spacing", "0.3rem"],
      ]),
    );
  });

  it("maps typography tokens to their CSS variable names", () => {
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            type: {
              sans: "'VT323', monospace",
              mono: "'VT323', monospace",
              display: "'Press Start 2P', monospace",
              chromeTracking: "1px",
              chromeTransform: "uppercase",
            },
          },
        },
      }),
      "dark",
    );
    expect(vars).toEqual(
      expect.arrayContaining([
        ["--ui-font-sans", "'VT323', monospace"],
        ["--ui-font-mono", "'VT323', monospace"],
        ["--ui-font-display", "'Press Start 2P', monospace"],
        ["--chrome-tracking", "1px"],
        ["--chrome-transform", "uppercase"],
      ]),
    );
  });

  it("keeps ALL_VARS a superset of every emitted shape and type name", () => {
    const vars = resolveThemeVars(
      theme({
        variants: {
          dark: {
            shape: { frameWidth: "8px", bevelOuter: "#000", spacing: "1rem" },
            type: { sans: "x", display: "y", chromeTransform: "uppercase" },
          },
        },
      }),
      "dark",
    );
    for (const [name] of vars ?? []) expect(ALL_VARS).toContain(name);
  });
});
