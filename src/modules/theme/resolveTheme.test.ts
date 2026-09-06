import { describe, expect, it } from "vitest";
import { contrast } from "./oklab";
import { resolveTheme } from "./resolveTheme";
import { listBuiltinThemes } from "./themes";
import { TOKENS } from "./tokens";
import {
  STATUS_ROLES,
  SYNTAX_ROLES,
  type Theme,
  type ThemeMode,
} from "./types";

const MODES: ThemeMode[] = ["light", "dark"];
const get = (vars: readonly (readonly [string, string])[], name: string) =>
  vars.find(([n]) => n === name)?.[1];
const DIM_ROLES = new Set(["comment", "gutterFg", "tagBracket"]);
const cssVar = (key: string) =>
  TOKENS.find((t) => t.key === key)?.cssVar ?? key;

describe("resolveTheme", () => {
  // Replaces a 7000-line snapshot nobody could review. Every derived colour
  // must clear the floor its derive() promised, on every builtin, both modes.
  it("lifts every derived syntax and status colour to its contrast floor", () => {
    for (const theme of listBuiltinThemes()) {
      for (const mode of MODES) {
        const variant = theme.variants[mode];
        const bg = variant?.colors?.background;
        if (!variant || !bg) continue;
        const vars = resolveTheme(theme, mode) ?? [];
        for (const role of SYNTAX_ROLES) {
          if (variant.syntax?.[role]) continue;
          const v = get(vars, cssVar(`syntax.${role}`));
          expect(v, `${theme.id}/${mode} syntax.${role}`).toBeDefined();
          const floor = DIM_ROLES.has(role) ? 3 : 4.5;
          expect(
            contrast(v as string, bg),
            `${theme.id}/${mode} syntax.${role}`,
          ).toBeGreaterThanOrEqual(floor - 0.01);
        }
        for (const role of STATUS_ROLES) {
          if (variant.status?.[role]) continue;
          const v = get(vars, cssVar(`status.${role}`));
          expect(v, `${theme.id}/${mode} status.${role}`).toBeDefined();
          expect(
            contrast(v as string, bg),
            `${theme.id}/${mode} status.${role}`,
          ).toBeGreaterThanOrEqual(4.49);
        }
      }
    }
  });

  it("maps keyword tokens onto their CSS values", () => {
    const theme: Theme = {
      id: "flat",
      name: "Flat",
      variants: {
        dark: {
          colors: { background: "#101010", foreground: "#f0f0f0" },
          effects: { blur: "off", shadow: "transparent" },
          shape: { pillRadius: "2px" },
        },
      },
    };
    const vars = resolveTheme(theme, "dark") ?? [];
    expect(get(vars, "--fx-blur-factor")).toBe("0");
    expect(get(vars, "--fx-shadow-color")).toBe("transparent");
    expect(get(vars, "--radius-pill")).toBe("2px");
  });

  it("defaults to blur on, no shadow tint, and a round pill", () => {
    const vars =
      resolveTheme(
        {
          id: "bare",
          name: "Bare",
          variants: { dark: { colors: { background: "#101010" } } },
        },
        "dark",
      ) ?? [];
    expect(get(vars, "--fx-blur-factor")).toBe("1");
    expect(get(vars, "--fx-shadow-color")).toBeUndefined();
    expect(get(vars, "--radius-pill")).toBe("9999px");
  });

  // Audit bug: a missing foreground used to null all 18 syntax vars.
  it("degrades one token, not the whole syntax palette, when foreground is absent", () => {
    const theme: Theme = {
      id: "no-fg",
      name: "No Foreground",
      variants: {
        dark: {
          colors: { background: "#101010" },
          terminal: { ansi: Array(16).fill("#8899aa") as never },
        },
      },
    };
    const vars = resolveTheme(theme, "dark");
    expect(vars).not.toBeNull();
    expect(get(vars ?? [], "--syntax-keyword")).toBeDefined();
    expect(get(vars ?? [], "--syntax-string")).toBeDefined();
  });

  // Audit bug: contrast used to be enforced only when both colours were hex.
  it("enforces contrast for rgb() themes, not only hex ones", () => {
    const theme: Theme = {
      id: "rgb-theme",
      name: "RGB",
      variants: {
        dark: {
          colors: {
            background: "rgb(16,16,16)",
            foreground: "rgb(240,240,240)",
          },
          terminal: { ansi: Array(16).fill("rgb(20,20,20)") as never },
        },
      },
    };
    const vars = resolveTheme(theme, "dark");
    const keyword = get(vars ?? [], "--syntax-keyword");
    expect(keyword).toBeDefined();
    // A near-black keyword on a near-black canvas must have been lifted.
    expect(keyword).not.toBe("rgb(20,20,20)");
  });

  // The ladder is meant to be theme-owned. Without this the six steps are just
  // global constants and a theme that leans on outlines cannot say so.
  it("lets a theme override an emphasis step", () => {
    const theme: Theme = {
      id: "outlined",
      name: "Outlined",
      variants: {
        dark: {
          colors: { background: "#101010", foreground: "#f0f0f0" },
          emphasis: { strong: "90%" },
        },
      },
    };
    const vars = resolveTheme(theme, "dark") ?? [];
    expect(get(vars, "--emph-strong")).toBe("90%");
    // Untouched steps still fall back to the registry defaults.
    expect(get(vars, "--emph-faint")).toBe("10%");
  });

  it("returns null when the theme has no usable variant", () => {
    expect(
      resolveTheme({ id: "empty", name: "Empty", variants: {} }, "dark"),
    ).toBeNull();
  });

  // The one snapshot kept: Nothing dark is the acceptance case for the
  // structural tokens, and at roughly 90 lines it is reviewable.
  it("resolves Nothing dark to its structural identity", () => {
    const nothing = listBuiltinThemes().find((t) => t.id === "nothing");
    expect(nothing).toBeDefined();
    const vars = resolveTheme(nothing as Theme, "dark") ?? [];
    expect(get(vars, "--border-style")).toBe("dotted");
    expect(get(vars, "--frame-border-width")).toBe("2px");
    expect(get(vars, "--radius-pill")).toBe("2px");
    expect(get(vars, "--chrome-transform")).toBe("uppercase");
    expect(get(vars, "--fx-shadow-color")).toBe("transparent");
    expect(get(vars, "--fx-blur-factor")).toBe("0");
    expect(vars).toMatchSnapshot();
  });
});
