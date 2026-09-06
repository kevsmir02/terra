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

  it("pins every face to the app font and keeps spacing themeable", () => {
    expect(GLOBALS).toContain('--font-sans: "JetBrainsMono Nerd Font", monospace');
    expect(GLOBALS).toContain('--font-mono: "JetBrainsMono Nerd Font", monospace');
    expect(GLOBALS).not.toContain("fonts.css");
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

const STATUS_ROLE_NAMES = [
  "added", "modified", "deleted", "renamed", "warning", "conflict", "ok",
] as const;

describe("status tokens", () => {
  it("wires every role through @theme inline", () => {
    for (const role of STATUS_ROLE_NAMES) {
      expect(GLOBALS).toContain(
        `--color-status-${role}: var(--status-${role});`,
      );
    }
  });

  it("declares a light and a dark default for every role", () => {
    const darkStart = GLOBALS.indexOf(".dark {");
    const root = GLOBALS.slice(GLOBALS.indexOf(":root {"), darkStart);
    // Both slices must be bounded. Left open, the dark slice runs to EOF, and
    // four more :root blocks follow it, so a default misplaced outside .dark
    // would still be found and this test would pass while dark mode broke.
    const dark = GLOBALS.slice(darkStart, GLOBALS.indexOf("}", darkStart) + 1);
    for (const role of STATUS_ROLE_NAMES) {
      expect(root).toContain(`--status-${role}:`);
      expect(dark).toContain(`--status-${role}:`);
    }
  });

  it("compiles text and bg utilities for every role", async () => {
    const inline = GLOBALS.slice(
      GLOBALS.indexOf("@theme inline"),
      GLOBALS.indexOf("@utility border"),
    );
    const css = await build(
      `@import "tailwindcss";\n${inline}`,
      STATUS_ROLE_NAMES.flatMap((r) => [`text-status-${r}`, `bg-status-${r}`]),
    );
    for (const role of STATUS_ROLE_NAMES) {
      expect(css).toContain(`var(--status-${role})`);
    }
  });
});

describe("theme-owned scales", () => {
  const inline = () =>
    GLOBALS.slice(
      GLOBALS.indexOf("@theme inline"),
      GLOBALS.indexOf("@utility border"),
    );
  const utilities = () =>
    GLOBALS.split("\n").filter((l) => l.trimStart().startsWith("@utility rounded-"));

  it("routes every shadow utility through the theme's shadow tint", async () => {
    const css = await build(`@import "tailwindcss";\n${inline()}`, [
      "shadow-2xs", "shadow-xs", "shadow-sm", "shadow-md", "shadow-lg",
      "shadow-xl", "shadow-2xl", "shadow", "shadow-inner",
    ]);
    const blocks = css.match(/\.shadow[^{]*\{[^}]*\}/g) ?? [];
    expect(blocks).toHaveLength(9);
    for (const b of blocks) expect(b).toContain("var(--fx-shadow-color, rgb(0 0 0 /");
  });

  it("multiplies every blur step by the theme's blur factor", async () => {
    const css = await build(`@import "tailwindcss";\n${inline()}`, [
      "backdrop-blur", "backdrop-blur-xs", "backdrop-blur-sm", "backdrop-blur-md",
      "backdrop-blur-lg", "backdrop-blur-xl", "backdrop-blur-2xl", "backdrop-blur-3xl",
    ]);
    const blocks = css.match(/\.backdrop-blur[^{]*\{[^}]*\}/g) ?? [];
    expect(blocks).toHaveLength(8);
    for (const b of blocks) expect(b).toContain("blur(calc(var(--fx-blur-factor, 1) *");
  });

  it("scales rounded-xs with the theme radius like the other steps", () => {
    expect(inline()).toContain("--radius-xs: calc(var(--radius) * 0.4)");
  });

  it("gives pills a theme radius and circles a fixed one", async () => {
    const css = await build(
      `@import "tailwindcss";\n${utilities().join("\n")}`,
      ["rounded-pill", "rounded-circle"],
    );
    expect(css).toContain(".rounded-pill {\n    border-radius: var(--radius-pill, 9999px);");
    expect(css).toContain(".rounded-circle {\n    border-radius: 50%;");
  });
});
