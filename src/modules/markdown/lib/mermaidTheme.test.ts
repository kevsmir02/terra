import { describe, expect, it } from "vitest";
import { mermaidThemeConfig, toHex } from "./mermaidTheme";

const HEX = /^#[0-9a-f]{6}$/;

describe("mermaidThemeConfig", () => {
  it("re-emits every colour as hex, whatever notation the theme authored", () => {
    const cfg = mermaidThemeConfig(
      [
        ["--background", "oklch(0.188 0.006 68)"],
        ["--foreground", "#e0deda"],
        ["--muted", "rgb(40, 40, 40)"],
        ["--border", "hsl(30 10% 30%)"],
      ],
      "dark",
    );
    for (const role of ["background", "textColor", "mainBkg", "nodeBorder"]) {
      expect(cfg.themeVariables[role]).toMatch(HEX);
    }
    expect(cfg.theme).toBe("base");
    expect(cfg.darkMode).toBe(true);
    expect(cfg.themeVariables.darkMode).toBe(true);
  });

  it("leaves a role Mermaid can derive when the theme has no value for it", () => {
    const cfg = mermaidThemeConfig([["--foreground", "#ffffff"]], "light");
    expect(cfg.themeVariables.background).toBeUndefined();
    expect(cfg.themeVariables.textColor).toBe("#ffffff");
    expect(cfg.darkMode).toBe(false);
  });

  it("never passes a colour Mermaid cannot parse", () => {
    expect(toHex("oklch(0.7 0.012 78)")).toMatch(HEX);
    expect(toHex("var(--foreground)")).toBeNull();
    expect(toHex(undefined)).toBeNull();
  });
});
