import { describe, expect, it } from "vitest";
import { validateTheme } from "./validateTheme";

function baseTheme(over: Record<string, unknown> = {}) {
  return {
    id: "ok-id",
    name: "Cool Theme",
    variants: { dark: { colors: { background: "#000" } } },
    ...over,
  };
}

describe("validateTheme", () => {
  it("rejects a non-object payload", () => {
    expect(validateTheme("nope")).toEqual({
      ok: false,
      error: "Theme must be a JSON object",
    });
  });

  it("rejects ids that are not kebab-case or too short", () => {
    expect(validateTheme(baseTheme({ id: "Foo" })).ok).toBe(false);
    expect(validateTheme(baseTheme({ id: "a" })).ok).toBe(false);
    expect(validateTheme(baseTheme({ id: "has space" })).ok).toBe(false);
  });

  it("requires a non-empty name and trims it", () => {
    expect(validateTheme(baseTheme({ name: "  " })).ok).toBe(false);
    const result = validateTheme(baseTheme({ name: "  Padded  " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme.name).toBe("Padded");
  });

  it("requires a variants object with at least one of light or dark", () => {
    expect(validateTheme(baseTheme({ variants: undefined })).ok).toBe(false);
    expect(validateTheme(baseTheme({ variants: {} }))).toEqual({
      ok: false,
      error: "variants must contain at least one of: light, dark",
    });
  });

  it("accepts a minimal single-variant theme", () => {
    const result = validateTheme({
      id: "ok-id",
      name: "X",
      variants: { dark: {} },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unrecognized color keys", () => {
    const result = validateTheme(
      baseTheme({ variants: { dark: { colors: { nope: "#fff" } } } }),
    );
    expect(result).toEqual({
      ok: false,
      error: "variants.dark.colors.nope is not a recognized color key",
    });
  });

  it("rejects empty color values", () => {
    const result = validateTheme(
      baseTheme({ variants: { dark: { colors: { background: "" } } } }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts an allowlisted borderStyle", () => {
    const result = validateTheme(
      baseTheme({ variants: { dark: { colors: { borderStyle: "dotted" } } } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.variants.dark?.colors?.borderStyle).toBe("dotted");
    }
  });

  it("rejects a borderStyle outside the allowlist", () => {
    for (const bad of ["groove", "dotted; content: url(x)", "SOLID"]) {
      const result = validateTheme(
        baseTheme({ variants: { dark: { colors: { borderStyle: bad } } } }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("requires the terminal ansi palette to have exactly 16 entries", () => {
    const result = validateTheme(
      baseTheme({ variants: { dark: { terminal: { ansi: ["#000"] } } } }),
    );
    expect(result).toEqual({
      ok: false,
      error: "variants.dark.terminal.ansi must be an array of 16 strings",
    });
  });

  it("captures optional author, description, and editor theme", () => {
    const result = validateTheme(
      baseTheme({
        author: "me",
        description: "a theme",
        editorTheme: { dark: "tokyo" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.author).toBe("me");
      expect(result.theme.description).toBe("a theme");
      expect(result.theme.editorTheme).toEqual({ dark: "tokyo" });
    }
  });

  it("accepts shape lengths and colors", () => {
    const result = validateTheme(
      baseTheme({
        variants: {
          dark: {
            shape: {
              frameWidth: "8px",
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
              spacing: "0.25rem",
            },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.variants.dark?.shape?.frameWidth).toBe("8px");
      expect(result.theme.variants.dark?.shape?.bevelOuter).toBe("#8a5a2e");
    }
  });

  it("rejects shape lengths that are not plain CSS lengths", () => {
    for (const bad of [
      "4px, 0 0 99px red",
      "calc(1px + 2px)",
      "url(x)",
      "4",
      "",
    ]) {
      const result = validateTheme(
        baseTheme({ variants: { dark: { shape: { bevelWidth: bad } } } }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("accepts zero as a length", () => {
    const result = validateTheme(
      baseTheme({ variants: { dark: { shape: { bevelWidth: "0" } } } }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unrecognized shape keys", () => {
    const result = validateTheme(
      baseTheme({ variants: { dark: { shape: { nope: "1px" } } } }),
    );
    expect(result).toEqual({
      ok: false,
      error: "variants.dark.shape.nope is not a recognized shape key",
    });
  });

  it("accepts typography keys and allowlists chromeTransform", () => {
    const ok = validateTheme(
      baseTheme({
        variants: {
          dark: {
            type: {
              sans: "'Press Start 2P', monospace",
              display: "'Press Start 2P', monospace",
              chromeTracking: "1px",
              chromeTransform: "uppercase",
            },
          },
        },
      }),
    );
    expect(ok.ok).toBe(true);
    const bad = validateTheme(
      baseTheme({
        variants: { dark: { type: { chromeTransform: "capitalize; x:y" } } },
      }),
    );
    expect(bad.ok).toBe(false);
  });
});

