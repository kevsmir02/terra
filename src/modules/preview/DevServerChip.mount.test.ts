import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("DevServerChip", () => {
  it("is mounted in exactly one place", () => {
    const sites = walk("src")
      .filter((p) => !p.endsWith("DevServerChip.tsx") && !p.includes(".test."))
      .filter((p) => /<DevServerChip\b/.test(readFileSync(p, "utf8")));
    expect(sites).toEqual(["src/modules/terminal/PaneTreeView.tsx"]);
  });
});
