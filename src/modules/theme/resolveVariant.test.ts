import { describe, expect, it } from "vitest";
import { resolveVariant } from "./resolveVariant";
import type { Theme } from "./types";

function theme(variants: Theme["variants"]): Theme {
  return { id: "t", name: "T", variants };
}

describe("resolveVariant", () => {
  it("returns the exact mode when present, reporting that mode", () => {
    const light = { colors: { background: "#fff" } };
    const dark = { colors: { background: "#000" } };
    expect(resolveVariant(theme({ light, dark }), "light")).toEqual({
      variant: light,
      mode: "light",
    });
  });

  // A dark-only theme viewed in light mode shows its dark surfaces app-wide,
  // so consumers must be told the dark variant is the one that won.
  it("falls back to dark and reports dark, not the requested mode", () => {
    const dark = { colors: { background: "#000" } };
    expect(resolveVariant(theme({ dark }), "light")).toEqual({
      variant: dark,
      mode: "dark",
    });
  });

  it("falls back to light and reports light when only light exists", () => {
    const light = { colors: { background: "#fff" } };
    expect(resolveVariant(theme({ light }), "dark")).toEqual({
      variant: light,
      mode: "light",
    });
  });

  it("returns null when no variant exists", () => {
    expect(resolveVariant(theme({}), "dark")).toBeNull();
  });
});
