import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Locks the theme consumption contract: chrome reaches the theme through the
// scales and role classes in globals.css, never through a literal a theme
// cannot see. A hit here is fixed at the site; the allowlist is for the few
// places where a literal is the design (a brand mark, a video surface).
const ROOT = path.resolve(__dirname, "../..");

type Rule = { id: string; pattern: RegExp; message: string };

const ALLOWLIST: Record<string, string> = {};

const RULES: Rule[] = [
  {
    id: "divider-fill",
    pattern: /\b(h-px|w-px)\b[^"'`]*\bbg-border\b|\bbg-border\b[^"'`]*\b(h-px|w-px)\b/,
    message: "a divider is a border, not a bg-border fill; it must take --border-style",
  },
];

function sourceFiles(): string[] {
  return globSync("src/**/*.{ts,tsx}", { cwd: ROOT }).filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
  );
}

function scan(rules: Rule[]): string[] {
  const offenders: string[] = [];
  for (const rel of sourceFiles()) {
    if (rel in ALLOWLIST) continue;
    const src = readFileSync(path.resolve(ROOT, rel), "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      for (const rule of rules) {
        if (rule.pattern.test(line)) {
          offenders.push(`${rel}:${i + 1} [${rule.id}] ${rule.message}`);
        }
      }
    });
  }
  return offenders;
}

describe("theme consumption contract", () => {
  it("has no literal escape hatch outside the allowlist", () => {
    expect(scan(RULES)).toEqual([]);
  });

  it("names a reason for every allowlisted file, and every file exists", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, file).toBeGreaterThan(10);
      expect(() => readFileSync(path.resolve(ROOT, file))).not.toThrow();
    }
  });
});
