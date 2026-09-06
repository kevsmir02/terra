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

  // Without this registration the property inherits, so `.terra-chrome` on the
  // header would hand its border width to every control inside it.
  it("registers --surface-border-width as non-inheriting", () => {
    const b = block("@property --surface-border-width");
    expect(b).toContain('syntax: "<length>"');
    expect(b).toContain("inherits: false");
    expect(b).toContain("initial-value: 1px");
  });

  // Inset from the window frame, so chrome never butts against a thick border.
  // Must default to 0 or every non-opting theme gains a stray gutter.
  it("insets the frame only when a theme asks for it", () => {
    expect(block(".terra-frame")).toContain("padding: var(--frame-padding, 0px)");
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
    expect(b).not.toContain("font-family");
  });

  it("draws the window frame in the theme's border style", () => {
    const i = CSS.indexOf('html[data-chrome="borderless"] #root,');
    expect(i).toBeGreaterThan(-1);
    const rule = CSS.slice(i, CSS.indexOf("}", i));
    expect(rule).toContain(
      "border: var(--frame-border-width, 1px) var(--border-style, solid) var(--border)",
    );
  });
});
