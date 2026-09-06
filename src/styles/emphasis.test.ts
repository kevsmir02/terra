import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TOKEN =
  "(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|sidebar)";
const LITERAL_ALPHA = new RegExp(
  `\\b(?:bg|text|border|ring|fill|stroke|divide|outline)-${TOKEN}[a-z-]*\\/[0-9]{1,3}\\b`,
);

describe("emphasis ladder", () => {
  it("has no literal alpha modifiers left on theme tokens", () => {
    const offenders: string[] = [];
    for (const file of globSync("src/**/*.tsx")) {
      const src = readFileSync(file, "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        if (LITERAL_ALPHA.test(line)) offenders.push(`${file}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
