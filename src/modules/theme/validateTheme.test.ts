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
    const res = validateTheme("nope");
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]).toMatchObject({
      severity: "error",
      message: "Theme must be a JSON object",
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
    
    const res = validateTheme(baseTheme({ variants: {} }));
    expect(res.ok).toBe(false);
    expect(res.diagnostics.find(d => d.message.includes("at least one of"))).toBeDefined();
  });

  it("accepts a minimal single-variant theme", () => {
    const result = validateTheme({
      id: "ok-id",
      name: "X",
      variants: { dark: {} },
    });
    expect(result.ok).toBe(true);
  });

  it("reports every bad key, not just the first", () => {
    const res = validateTheme({
      id: "xx", name: "X",
      variants: { dark: { colors: { background: "nope", foreground: "also-nope" } } },
    });
    expect(res.ok).toBe(false);
    expect(res.diagnostics.filter((d) => d.severity === "error")).toHaveLength(2);
  });

  it("treats an unknown key as a warning so newer themes still load", () => {
    const res = validateTheme({
      id: "xx", name: "X",
      variants: { dark: { colors: { background: "#101010", spork: "#fff" } } },
    });
    expect(res.ok).toBe(true);
    expect(res.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "warning", path: "variants.dark.colors.spork" }),
    );
  });

  it("rejects an unparseable textColor but accepts it for a plain color", () => {
    const bad = validateTheme({
      id: "xx", name: "X",
      variants: { dark: { colors: { foreground: "transparent" } } },
    });
    expect(bad.ok).toBe(false);

    const ok = validateTheme({
      id: "yy", name: "Y",
      variants: { dark: { colors: { border: "rgba(255,255,255,0.08)" } } },
    });
    expect(ok.ok).toBe(true);
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
    expect(result.ok).toBe(false);
    expect(result.diagnostics.find(d => d.message.includes("16 strings"))).toBeDefined();
  });

  it("accepts optional terminal font settings", () => {
    const result = validateTheme(
      baseTheme({
        variants: {
          dark: {
            terminal: {
              fontFamily: "  JetBrainsMono Nerd Font  ",
              fontWeight: "600",
              fontSize: 16,
            },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.variants.dark?.terminal).toEqual({
        fontFamily: "JetBrainsMono Nerd Font",
        fontWeight: "600",
        fontSize: 16,
      });
    }
  });

  it("rejects invalid terminal font settings", () => {
    expect(
      validateTheme(
        baseTheme({
          variants: { dark: { terminal: { fontFamily: "  " } } },
        }),
      ).ok,
    ).toBe(false);
    
    expect(
      validateTheme(
        baseTheme({
          variants: { dark: { terminal: { fontWeight: "heavy" } } },
        }),
      ).ok,
    ).toBe(false);
    
    expect(
      validateTheme(
        baseTheme({
          variants: { dark: { terminal: { fontSize: 100 } } },
        }),
      ).ok,
    ).toBe(false);
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
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "warning", path: "variants.dark.shape.nope" })
    );
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

describe("syntax and status overrides", () => {
  function withVariant(variant: unknown) {
    return { id: "ok-id", name: "T", variants: { dark: variant } };
  }

  it("accepts a partial syntax override", () => {
    const r = validateTheme(withVariant({ syntax: { keyword: "#abcdef" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme.variants.dark?.syntax?.keyword).toBe("#abcdef");
  });

  it("accepts a partial status override", () => {
    const r = validateTheme(withVariant({ status: { modified: "#abcdef" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme.variants.dark?.status?.modified).toBe("#abcdef");
  });

  it("rejects an unknown syntax key", () => {
    const r = validateTheme(withVariant({ syntax: { notARole: "#abcdef" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.find(d => d.path.includes("notARole"))).toBeDefined();
  });

  it("rejects an unknown status key", () => {
    const r = validateTheme(withVariant({ status: { info: "#abcdef" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.find(d => d.path.includes("info"))).toBeDefined();
  });

  it("rejects a non-string syntax value", () => {
    const r = validateTheme(withVariant({ syntax: { keyword: 5 } }));
    expect(r.ok).toBe(false);
  });
});

describe("shape colour validation", () => {
  function withShape(shape: unknown) {
    return { id: "ok-id", name: "T", variants: { dark: { shape } } };
  }

  it.each(["#abc", "#aabbcc", "transparent", "rgb(1,2,3)", "rgba(1,2,3,0.5)", "oklch(0.5 0.1 200)"])(
    "accepts %s",
    (value) => {
      expect(validateTheme(withShape({ bevelOuter: value })).ok).toBe(true);
    },
  );

  it.each(["red; color: blue", "url(x)", "}", "#12", "notacolour"])(
    "rejects %s",
    (value) => {
      expect(validateTheme(withShape({ bevelOuter: value })).ok).toBe(false);
    },
  );
});
