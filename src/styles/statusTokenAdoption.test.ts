import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

// Only the hues that carry git and diagnostic meaning. Neutrals such as zinc
// are out of scope: SourceControlPanel's always-dark tooltip is a deliberate
// design choice, not a missing token, so it needs no allowlist entry.
const SEMANTIC_HUES =
  /\b(?:bg|text|border|ring|fill|stroke)-(?:emerald|amber|rose|sky|teal|green|red|yellow|blue)-\d{2,3}\b/;

describe("status colour adoption", () => {
  it("leaves no semantic status hue hardcoded anywhere", async () => {
    const { globSync } = await import("node:fs");
    const files = [
      ...globSync("src/**/*.tsx", { cwd: ROOT }),
      ...globSync("src/**/*.ts", { cwd: ROOT }),
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const src = readFileSync(path.resolve(ROOT, rel), "utf8");
      for (const line of src.split("\n")) {
        const m = line.match(SEMANTIC_HUES);
        if (m) offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
