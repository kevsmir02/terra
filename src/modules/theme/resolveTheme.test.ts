import { describe, expect, it } from "vitest";
import { resolveTheme } from "./resolveTheme";
import { listBuiltinThemes } from "./themes";
import type { Theme, ThemeMode } from "./types";

const MODES: ThemeMode[] = ["light", "dark"];
const get = (vars: readonly (readonly [string, string])[], name: string) =>
  vars.find(([n]) => n === name)?.[1];

describe("resolveTheme", () => {
  it("resolves every builtin in both modes to a stable variable set", () => {
    for (const theme of listBuiltinThemes()) {
      for (const mode of MODES) {
        expect({ id: theme.id, mode, vars: resolveTheme(theme, mode) })
          .toMatchSnapshot(`${theme.id}-${mode}`);
      }
    }
  });

  // Audit bug: a missing foreground used to null all 18 syntax vars.
  it("degrades one token, not the whole syntax palette, when foreground is absent", () => {
    const theme: Theme = {
      id: "no-fg", name: "No Foreground",
      variants: { dark: { colors: { background: "#101010" },
        terminal: { ansi: Array(16).fill("#8899aa") as never } } },
    };
    const vars = resolveTheme(theme, "dark");
    expect(vars).not.toBeNull();
    expect(get(vars ?? [], "--syntax-keyword")).toBeDefined();
    expect(get(vars ?? [], "--syntax-string")).toBeDefined();
  });

  // Audit bug: contrast used to be enforced only when both colours were hex.
  it("enforces contrast for rgb() themes, not only hex ones", () => {
    const theme: Theme = {
      id: "rgb-theme", name: "RGB",
      variants: { dark: {
        colors: { background: "rgb(16,16,16)", foreground: "rgb(240,240,240)" },
        terminal: { ansi: Array(16).fill("rgb(20,20,20)") as never },
      } },
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
          emphasis: { strong: "0.9" },
        },
      },
    };
    const vars = resolveTheme(theme, "dark") ?? [];
    expect(get(vars, "--emph-strong")).toBe("0.9");
    // Untouched steps still fall back to the registry defaults.
    expect(get(vars, "--emph-faint")).toBe("0.1");
  });

  it("returns null when the theme has no usable variant", () => {
    expect(resolveTheme({ id: "empty", name: "Empty", variants: {} }, "dark"))
      .toBeNull();
  });
});
