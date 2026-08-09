import { describe, expect, it } from "vitest";
import { sanitizeStoredThemes } from "./customThemes";

describe("sanitizeStoredThemes", () => {
  it("returns an empty array for a non-array payload", () => {
    expect(sanitizeStoredThemes(null).themes).toEqual([]);
    expect(sanitizeStoredThemes({ id: "x" }).themes).toEqual([]);
    expect(sanitizeStoredThemes("nope").themes).toEqual([]);
  });

  it("keeps valid themes", () => {
    const theme = {
      id: "good-one",
      name: "Good",
      variants: { dark: { colors: { background: "#000" } } },
    };
    const out = sanitizeStoredThemes([theme]);
    expect(out.themes).toHaveLength(1);
    expect(out.themes[0].id).toBe("good-one");
  });

  it("drops entries that fail validation without discarding valid siblings", () => {
    const good = {
      id: "good-one",
      name: "Good",
      variants: { dark: { colors: { background: "#000" } } },
    };
    const bad = { id: "Bad Id", name: "Bad", variants: { dark: {} } };
    const out = sanitizeStoredThemes([good, bad, "junk", null]);
    expect(out.themes.map((t) => t.id)).toEqual(["good-one"]);
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
    expect(out.themes[0].name).toBe("Padded");
    expect(out.themes[0]).not.toHaveProperty("somethingExtra");
  });

  it("reports which stored theme was rejected and why", () => {
    const res = sanitizeStoredThemes([
      { id: "good", name: "Good", variants: { dark: { colors: { background: "#101010" } } } },
      { id: "bad", name: "Bad", variants: { dark: { colors: { background: "nope" } } } },
    ]);
    expect(res.themes.map((t) => t.id)).toEqual(["good"]);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].id).toBe("bad");
  });
});
