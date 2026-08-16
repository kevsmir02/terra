import { describe, expect, it } from "vitest";
import {
  nextSitePort,
  resolveSiteKind,
  slugFromName,
  uniqueSlug,
} from "@/modules/services/lib/sites";

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

describe("uniqueSlug", () => {
  it("returns the base slug when it is unused", () => {
    expect(uniqueSlug("My App", new Set())).toBe("my-app");
  });

  it("appends the next available suffix for collisions", () => {
    const taken = new Set(["my-app", "my-app-2"]);
    expect(uniqueSlug("My App", taken)).toBe("my-app-3");
  });

  it("uses the site fallback for empty slugs", () => {
    const taken = new Set(["site"]);
    expect(uniqueSlug("///", taken)).toBe("site-2");
  });

  it("keeps colliding slugs within the 63 character limit", () => {
    const name = "x".repeat(200);
    const first = uniqueSlug(name, new Set());
    const second = uniqueSlug(name, new Set([first]));

    expect(first).toHaveLength(63);
    expect(second).toBe(`${"x".repeat(61)}-2`);
    expect(second).toHaveLength(63);
  });
});

describe("nextSitePort", () => {
  it("starts at 8000 and skips taken and reserved ports", () => {
    expect(nextSitePort([])).toBe(8000);
    expect(nextSitePort([8000, 8001])).toBe(8002);
    expect(nextSitePort([8000, 8001, 8002, 8003, 8004])).toBe(8005);
  });
});

describe("resolveSiteKind", () => {
  it("lets a confident detection change a saved kind", () => {
    expect(resolveSiteKind("static", { kind: "php", confident: true })).toBe(
      "php",
    );
  });

  it("never lets an unconfident guess downgrade a saved kind", () => {
    // sites_detect falls back to unconfident "static" whenever it cannot read
    // the directory, which used to be persisted over a working PHP site.
    expect(resolveSiteKind("php", { kind: "static", confident: false })).toBe(
      "php",
    );
  });

  it("falls back to the guess when nothing is saved yet", () => {
    expect(
      resolveSiteKind(undefined, { kind: "static", confident: false }),
    ).toBe("static");
  });
});
