import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const TARGETS = [
  "src",
  "src-tauri/src",
  "TERRA.md",
  "THEME.md",
  "ROADMAP.md",
  "docs",
];
const TEXT = /\.(ts|tsx|css|md|json|rs|mjs|sh|zsh|bash|fish|toml|yml|yaml)$/;
const SKIP = new Set(["node_modules", "target", "assets", "generated"]);
// Spelled as an escape so this file never trips its own check.
const EM_DASH = "\u2014";

function walk(p: string, out: string[]): string[] {
  const stat = statSync(p);
  if (stat.isFile()) {
    if (TEXT.test(p)) out.push(p);
    return out;
  }
  for (const name of readdirSync(p)) {
    if (SKIP.has(name)) continue;
    walk(path.join(p, name), out);
  }
  return out;
}

// TERRA.md: no em-dash anywhere, in code, comments, commits, or docs.
describe("typography convention", () => {
  it("keeps em-dashes out of code, comments, and docs", () => {
    const files = TARGETS.flatMap((t) => walk(path.join(root, t), []));
    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes(EM_DASH))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});
