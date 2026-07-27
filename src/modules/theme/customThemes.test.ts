import { describe, expect, it } from "vitest";
import { sanitizeStoredThemes } from "./customThemes";

describe("sanitizeStoredThemes", () => {
  it("returns an empty array for a non-array payload", () => {
    expect(sanitizeStoredThemes(null)).toEqual([]);
    expect(sanitizeStoredThemes({ id: "x" })).toEqual([]);
    expect(sanitizeStoredThemes("nope")).toEqual([]);
  });

  it("keeps valid themes", () => {
    const theme = {
      id: "good-one",
      name: "Good",
      variants: { dark: { colors: { background: "#000" } } },
    };
    const out = sanitizeStoredThemes([theme]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("good-one");
  });

  it("drops entries that fail validation without discarding valid siblings", () => {
    const good = {
      id: "good-one",
      name: "Good",
      variants: { dark: { colors: { background: "#000" } } },
    };
    const bad = { id: "Bad Id", name: "Bad", variants: { dark: {} } };
    const out = sanitizeStoredThemes([good, bad, "junk", null]);
    expect(out.map((t) => t.id)).toEqual(["good-one"]);
  });

  it("returns the validated theme, not the raw entry", () => {
    const out = sanitizeStoredThemes([
      {
        id: "good-one",
        name: "  Padded  ",
        variants: { dark: { colors: { background: "#000" } } },
        somethingExtra: "ignored",
      },
    ]);
    expect(out[0].name).toBe("Padded");
    expect(out[0]).not.toHaveProperty("somethingExtra");
  });
});
