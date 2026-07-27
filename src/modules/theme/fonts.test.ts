import { describe, expect, it } from "vitest";
import { FONT_IDS, isFontId } from "./fonts";

describe("isFontId", () => {
  it("accepts every bundled id", () => {
    for (const id of FONT_IDS) expect(isFontId(id)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["comic-sans", "", null, 3, {}]) {
      expect(isFontId(bad)).toBe(false);
    }
  });
});
