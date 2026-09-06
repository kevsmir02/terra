import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.resolve(__dirname, "code-highlight.css"), "utf8");

const DECLS = CSS.split("\n").filter((l) => /^\s+--tok-/.test(l));

describe("code highlight tokens", () => {
  it("keeps both a light and a dark declaration for every role", () => {
    expect(DECLS).toHaveLength(34);
  });

  it("routes every declaration through a syntax variable", () => {
    for (const line of DECLS) {
      expect(line).toMatch(/--tok-[a-z]+:\s*var\(--syntax-[a-z-]+,/);
    }
  });

  // The fallback is what preserves the zero-change invariant: a theme that
  // derives nothing must render the exact oklch values shipped today.
  it("keeps an oklch fallback on every declaration", () => {
    for (const line of DECLS) {
      expect(line).toMatch(/,\s*oklch\([^)]*\)\)\s*;$/);
    }
  });
});
