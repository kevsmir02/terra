import { describe, expect, it } from "vitest";
import { nextSitePort, slugFromName } from "@/modules/services/lib/sites";

describe("slugFromName", () => {
  it("produces a safe DNS-style label", () => {
    expect(slugFromName("My App")).toBe("my-app");
    expect(slugFromName("../evil")).toBe("evil");
    expect(slugFromName("a/b")).toBe("a-b");
    expect(slugFromName("--Lead--")).toBe("lead");
  });

  it("truncates to the 63 character label limit", () => {
    expect(slugFromName("x".repeat(200))).toHaveLength(63);
  });

  it("returns an empty string when nothing usable survives", () => {
    expect(slugFromName("///")).toBe("");
  });
});

describe("nextSitePort", () => {
  it("starts at 8000 and skips taken and reserved ports", () => {
    expect(nextSitePort([])).toBe(8000);
    expect(nextSitePort([8000, 8001])).toBe(8002);
    expect(nextSitePort([8000, 8001, 8002, 8003, 8004])).toBe(8005);
  });
});
