import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const CSS = readFileSync(path.resolve(__dirname, "globals.css"), "utf8");

function keyframes(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /@keyframes (terra-[\w-]+) \{/g;
  for (let m = re.exec(CSS); m; m = re.exec(CSS)) {
    // Walk braces so nested keyframe steps are captured whole.
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    do {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") depth--;
      i++;
    } while (depth > 0 && i < CSS.length);
    out.push({ name: m[1], body: CSS.slice(start, i) });
  }
  return out;
}

function sources(): string {
  return globSync("src/**/*.{ts,tsx}", { cwd: ROOT })
    .filter((f) => !f.includes(".test."))
    .map((f) => readFileSync(path.join(ROOT, f), "utf8"))
    .join("\n");
}

describe("motion", () => {
  it("declares keyframes", () => {
    expect(keyframes().length).toBeGreaterThan(0);
  });

  // The whole point of these animations is that they cost the compositor a
  // transform and nothing else. `height`, `filter`, `box-shadow`, `width` and
  // friends force a layout or a repaint on every frame, and on this stack they
  // run over a streaming terminal.
  it.each(keyframes())(
    "$name animates only compositor properties",
    ({ body }) => {
      const props = [...body.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
      expect(props.length).toBeGreaterThan(0);
      for (const prop of props) {
        expect(["transform", "opacity"]).toContain(prop);
      }
    },
  );

  // Dead animation CSS is what this file exists to prevent coming back: every
  // class the stylesheet defines has to be worn by something.
  it.each(keyframes())("$name has a consumer in src", ({ name }) => {
    expect(CSS).toContain(`.${name} {`);
    expect(sources()).toContain(name);
  });

  // applyTheme writes --motion-scale to the root as an inline style, which
  // outranks any stylesheet rule, so reduced motion has to collapse a
  // different multiplier or a theme's own speed would win.
  it("gives reduced motion a multiplier the theme cannot outrank", () => {
    const reduced = CSS.slice(CSS.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("--motion-reduce");
    expect(reduced).not.toContain("--motion-scale:");
    for (const step of ["--dur-fast", "--dur-base", "--dur-slow"]) {
      const decl = CSS.slice(CSS.indexOf(`${step}:`));
      expect(decl.slice(0, decl.indexOf(";"))).toContain("var(--motion-reduce");
    }
  });
});
