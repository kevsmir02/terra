import { describe, expect, it } from "vitest";
import { statusFromAnsi, syntaxFromAnsi } from "./derive";
import { contrast } from "./oklab";
import { SYNTAX_ROLES, STATUS_ROLES, type TerminalPalette } from "./types";

// Distinct, high-contrast slots so mapping assertions are unambiguous.
const ansi = [
  "#100000", "#ff0000", "#00ff00", "#ffff00",
  "#0000ff", "#ff00ff", "#00ffff", "#cccccc",
  "#888888", "#ff8080", "#80ff80", "#ffff80",
  "#8080ff", "#ff80ff", "#80ffff", "#ffffff",
] as unknown as NonNullable<TerminalPalette["ansi"]>;

const terminal: TerminalPalette = { background: "#000000", foreground: "#eeeeee", ansi };
const colors = { background: "#000000", foreground: "#eeeeee", card: "#111111" };

describe("syntaxFromAnsi", () => {
  it("returns null without an ansi palette", () => {
    expect(syntaxFromAnsi({ background: "#000" }, colors, undefined)).toBeNull();
    expect(syntaxFromAnsi(undefined, colors, undefined)).toBeNull();
  });

  it("returns a value for every role", () => {
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(p).not.toBeNull();
    for (const role of SYNTAX_ROLES) {
      expect(typeof p?.[role]).toBe("string");
    }
  });

  it("maps roles to their documented ansi slots", () => {
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(p?.keyword).toBe("#ff00ff");
    expect(p?.string).toBe("#00ff00");
    expect(p?.number).toBe("#ffff00");
    // func (slot 4, pure blue) is exercised in "raises a low-contrast slot to
    // its floor" below instead: on this background it fails 4.5:1 and must be
    // raised, so it cannot also be asserted unmodified here.
    expect(p?.property).toBe("#00ffff");
    expect(p?.type).toBe("#80ffff");
    expect(p?.constant).toBe("#ff80ff");
    expect(p?.attr).toBe("#ffff80");
    expect(p?.tag).toBe("#ff0000");
    expect(p?.invalid).toBe("#ff8080");
  });

  it("maps comment, gutterFg and tagBracket all to bright black", () => {
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(p?.comment).toBe("#888888");
    expect(p?.gutterFg).toBe("#888888");
    expect(p?.tagBracket).toBe("#888888");
  });

  it("uses the terminal foreground for variable and operator", () => {
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(p?.variable).toBe("#eeeeee");
    expect(p?.operator).toBe("#eeeeee");
  });

  it("falls back to the colors foreground when the terminal omits one", () => {
    const p = syntaxFromAnsi({ ansi }, colors, undefined);
    expect(p?.variable).toBe("#eeeeee");
  });

  it("lets a partial override replace only its own keys", () => {
    const p = syntaxFromAnsi(terminal, colors, { keyword: "#abcdef" });
    expect(p?.keyword).toBe("#abcdef");
    expect(p?.string).toBe("#00ff00");
  });

  it("ignores an override key set to undefined", () => {
    const p = syntaxFromAnsi(terminal, colors, { keyword: undefined });
    expect(p?.keyword).toBe("#ff00ff");
  });

  it("raises a low-contrast slot to its floor", () => {
    // Slot 4 pure blue on black is about 2.4:1 and must be lifted.
    const p = syntaxFromAnsi(terminal, colors, undefined);
    expect(contrast(p?.func ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("holds dim roles to 3:1 rather than 4.5:1", () => {
    const dim: TerminalPalette = {
      foreground: "#eeeeee",
      ansi: ansi.map((c, i) => (i === 8 ? "#3a3a3a" : c)) as never,
    };
    const p = syntaxFromAnsi(dim, colors, undefined);
    const ratio = contrast(p?.comment ?? "", "#000000");
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(4.5);
  });

  it("applies the floor to an override too", () => {
    const p = syntaxFromAnsi(terminal, colors, { keyword: "#050505" });
    expect(contrast(p?.keyword ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("passes a non-hex override through untouched", () => {
    const p = syntaxFromAnsi(terminal, colors, { keyword: "var(--x)" });
    expect(p?.keyword).toBe("var(--x)");
  });
});

describe("statusFromAnsi", () => {
  it("returns null without an ansi palette", () => {
    expect(statusFromAnsi({ background: "#000" }, colors, undefined)).toBeNull();
  });

  it("returns a value for every role", () => {
    const s = statusFromAnsi(terminal, colors, undefined);
    for (const role of STATUS_ROLES) {
      expect(typeof s?.[role]).toBe("string");
    }
  });

  it("maps roles to their documented ansi slots", () => {
    const s = statusFromAnsi(terminal, colors, undefined);
    expect(s?.added).toBe("#00ff00");
    expect(s?.modified).toBe("#ffff00");
    expect(s?.deleted).toBe("#ff0000");
    expect(s?.conflict).toBe("#00ffff");
    expect(s?.ok).toBe("#00ff00");
  });

  it("clears the floor against both background and card", () => {
    const s = statusFromAnsi(terminal, colors, undefined);
    for (const role of STATUS_ROLES) {
      expect(contrast(s?.[role] ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s?.[role] ?? "", "#111111")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("lets a partial override replace only its own keys", () => {
    const s = statusFromAnsi(terminal, colors, { modified: "#abcdef" });
    expect(s?.modified).toBe("#abcdef");
    expect(s?.added).toBe("#00ff00");
  });
});
