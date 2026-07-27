import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "globals.css"),
  "utf8",
);

function block(selector: string): string {
  const i = CSS.indexOf(`${selector} {`);
  expect(i, `${selector} not found in globals.css`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf("}", i));
}

describe("surface classes", () => {
  it.each([
    [".terra-frame", "--frame-border-width"],
    [".terra-chrome", "--chrome-border-width"],
    [".terra-panel", "--panel-border-width"],
    [".terra-slot", "--slot-border-width"],
    [".terra-control", "--control-border-width"],
  ])("%s scopes --surface-border-width from %s", (selector, token) => {
    const b = block(selector);
    expect(b).toContain(`--surface-border-width: var(${token}, 1px)`);
  });

  it("defaults every bevel input to a no-op", () => {
    for (const decl of [
      "--bevel-width: 0px",
      "--bevel-outer: transparent",
      "--bevel-mid: transparent",
      "--bevel-inner: transparent",
      "--lift-color: transparent",
      "--lift-depth: 0px",
    ]) {
      expect(CSS).toContain(decl);
    }
  });

  it("gives chrome labels inert typography defaults", () => {
    const b = block(".terra-chrome-label");
    expect(b).toContain("var(--chrome-tracking, inherit)");
    expect(b).toContain("var(--chrome-transform, none)");
    expect(b).toContain("var(--ui-font-display, inherit)");
  });
});
