import { isChangeFor } from "@/lib/appStore";
import { describe, expect, it } from "vitest";

describe("isChangeFor", () => {
  it("routes a change event to the store whose file it names", () => {
    const path = "/home/u/.local/share/terra/terra-spaces.json";
    expect(isChangeFor("spaces", path)).toBe(true);
    expect(isChangeFor("settings", path)).toBe(false);
  });

  it("does not match a file that only ends in the same name", () => {
    expect(isChangeFor("settings", "/x/old-terra-settings.json")).toBe(false);
  });
});
