import { readFileSync } from "node:fs";
import path from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

async function build(source: string, candidates: string[]): Promise<string> {
  const compiler = await compile(source, {
    base: ROOT,
    loadStylesheet: async () => {
      const p = path.resolve(ROOT, "node_modules/tailwindcss/index.css");
      return { path: p, base: path.dirname(p), content: readFileSync(p, "utf8") };
    },
  });
  return compiler.build(candidates);
}

const GLOBALS = readFileSync(
  path.resolve(ROOT, "src/styles/globals.css"),
  "utf8",
);

const OVERRIDE_LINES = GLOBALS.split("\n").filter((l) =>
  l.trimStart().startsWith("@utility border"),
);

describe("border width overrides", () => {
  it("declares one override per border edge utility, each falling back to 1px", () => {
    expect(OVERRIDE_LINES).toHaveLength(5);
    for (const line of OVERRIDE_LINES) {
      expect(line).toContain("var(--surface-border-width, 1px)");
    }
  });

  it("compiles so every edge utility reads the variable", async () => {
    const css = await build(
      `@import "tailwindcss";\n${OVERRIDE_LINES.join("\n")}`,
      ["border", "border-t", "border-b", "border-l", "border-r"],
    );
    for (const prop of [
      "border-width",
      "border-top-width",
      "border-bottom-width",
      "border-left-width",
      "border-right-width",
    ]) {
      expect(css).toContain(`${prop}: var(--surface-border-width, 1px)`);
    }
  });

  it("keeps the wrapped theme tokens falling back to today's values", () => {
    expect(GLOBALS).toContain(
      "--font-sans: var(--ui-font-sans, 'Inter Variable', sans-serif)",
    );
    expect(GLOBALS).toContain(
      "--font-mono: var(--ui-font-mono, 'JetBrains Mono', monospace)",
    );
    expect(GLOBALS).toContain("--spacing: var(--ui-spacing, 0.25rem)");
  });
});

describe("no element combines a bare border with an explicit width", () => {
  it("holds across the source tree", async () => {
    const { globSync } = await import("node:fs");
    const files = globSync("src/**/*.tsx", { cwd: ROOT });
    const offenders: string[] = [];
    for (const rel of files) {
      const src = readFileSync(path.resolve(ROOT, rel), "utf8");
      for (const m of src.matchAll(/class(?:Name)?="([^"]*)"/g)) {
        const classes = m[1].split(/\s+/);
        const bare = classes.includes("border");
        const sized = classes.some((c) => /^border(-[trblxy])?-\d+$/.test(c));
        if (bare && sized) offenders.push(`${rel}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
