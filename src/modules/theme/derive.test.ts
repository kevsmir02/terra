import { describe, expect, it } from "vitest";
import { statusFromAnsi, syntaxFromAnsi } from "./derive";
import { contrast, toOklab } from "./oklab";
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

const hue = (hex: string) => {
  const [, a, b] = toOklab(hex);
  return (Math.atan2(b, a) * 180) / Math.PI;
};
// Pins a normalized value back to the slot it came from. An absolute hue
// tolerance is the wrong tool here: gamut clipping drifts slot 4 by 2 to 3
// degrees, so a 2 degree bound sits exactly on the boundary, while the nearest
// other slot is 18 degrees away. Relative distance has a 16 degree margin.
const nearestSlotByHue = (got: string | undefined): number => {
  const h = hue(got ?? "");
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  ansi.forEach((c, i) => {
    const d = Math.abs(h - hue(c));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
};

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
    // Every slot-mapped role is pinned. A role left unasserted here could be
    // silently remapped to any other legible slot without a test failing, which is
    // the whole risk the mapping table carries for Tasks 4, 7, 8 and 9. The three
    // slot-4 roles (func, heading, renamed) are pinned by hue below instead,
    // because slot 4 fails its floor on this background and gets raised.
    expect(p?.property).toBe("#00ffff");
    expect(p?.type).toBe("#80ffff");
    expect(p?.constant).toBe("#ff80ff");
    expect(p?.attr).toBe("#ffff80");
    expect(p?.attrValue).toBe("#00ff00");
    expect(p?.link).toBe("#00ffff");
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

  // Slot 4 pure blue is 2.44:1 on this background and must be lifted, so it
  // cannot be asserted by value. The hue check is what pins these roles to slot
  // 4: remapping either to any already-legible slot would still pass a bare
  // contrast assertion.
  it.each(["func", "heading"] as const)(
    "raises %s from slot 4 to its floor while keeping its hue",
    (role) => {
      const p = syntaxFromAnsi(terminal, colors, undefined);
      expect(contrast(p?.[role] ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
      expect(p?.[role]).not.toBe("#0000ff");
      expect(nearestSlotByHue(p?.[role])).toBe(4);
    },
  );

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
    expect(s?.warning).toBe("#ffff00");
    expect(s?.conflict).toBe("#00ffff");
    expect(s?.ok).toBe("#00ff00");
  });

  // renamed is the one status role on slot 4, which fails its floor against both
  // surfaces here, so it is pinned by hue for the same reason func and heading are.
  it("raises renamed from slot 4 while keeping its hue", () => {
    const s = statusFromAnsi(terminal, colors, undefined);
    expect(s?.renamed).not.toBe("#0000ff");
    expect(nearestSlotByHue(s?.renamed)).toBe(4);
    expect(contrast(s?.renamed ?? "", "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  // Opposite-polarity surfaces cannot both be cleared by one lightness, so the
  // canvas keeps its guarantee rather than being silently undone by the card pass.
  //
  // The card value matters. Against a black canvas the colour needs luminance
  // >= 0.175, and a near-white card still permits <= 0.183, so pure white leaves
  // an overlap band and the test cannot bite. #eeeeee permits only <= 0.151,
  // which is a genuine empty intersection.
  it("keeps the canvas floor when background and card have opposite polarity", () => {
    const s = statusFromAnsi(
      terminal,
      { background: "#000000", foreground: "#f5f5f5", card: "#eeeeee" },
      undefined,
    );
    for (const role of STATUS_ROLES) {
      expect(contrast(s?.[role] ?? "", "#000000")).toBeGreaterThanOrEqual(4.48);
    }
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
