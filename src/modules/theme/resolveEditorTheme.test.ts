import { describe, expect, it } from "vitest";
import { resolveEditorTheme } from "./resolveEditorTheme";
import { getDefaultTheme } from "./themes";
import type { Theme } from "./types";

const ansi = Array.from(
  { length: 16 },
  (_, i) => `#${(i * 16).toString(16).padStart(2, "0").repeat(3)}`,
) as unknown as never;

const noAnsi: Theme = {
  id: "no-ansi",
  name: "No Ansi",
  variants: { dark: {}, light: {} },
};

const withAnsi: Theme = {
  id: "with-ansi",
  name: "With Ansi",
  variants: {
    dark: {
      colors: { background: "#000000", foreground: "#ffffff" },
      terminal: { ansi },
    },
    light: {
      colors: { background: "#ffffff", foreground: "#000000" },
      terminal: { ansi },
    },
  },
};

const darkOnly: Theme = {
  id: "dark-only",
  name: "Dark Only",
  variants: {
    dark: {
      colors: { background: "#000000", foreground: "#ffffff" },
      terminal: { ansi },
    },
  },
};

describe("resolveEditorTheme", () => {
  it("returns an explicit pref as a preset, ignoring the app theme", () => {
    expect(resolveEditorTheme("nord", withAnsi, "dark")).toEqual({
      kind: "preset",
      id: "nord",
    });
  });

  it("derives when the theme has an ansi palette", () => {
    expect(resolveEditorTheme("auto", withAnsi, "dark")).toEqual({
      kind: "derived",
      mode: "dark",
    });
    expect(resolveEditorTheme("auto", withAnsi, "light")).toEqual({
      kind: "derived",
      mode: "light",
    });
  });

  // The variant that supplied the colours decides the frame, so a dark-only
  // theme in light mode must not mount a light editor over dark syntax.
  it("reports the winning variant mode for a single-variant theme", () => {
    expect(resolveEditorTheme("auto", darkOnly, "light")).toEqual({
      kind: "derived",
      mode: "dark",
    });
  });

  it("falls back to a neutral preset per mode without an ansi palette", () => {
    expect(resolveEditorTheme("auto", noAnsi, "dark")).toEqual({
      kind: "preset",
      id: "atomone",
    });
    expect(resolveEditorTheme("auto", noAnsi, "light")).toEqual({
      kind: "preset",
      id: "github-light",
    });
  });

  it("derives the default theme from its own ansi palette", () => {
    expect(resolveEditorTheme("auto", getDefaultTheme(), "dark")).toEqual({
      kind: "derived",
      mode: "dark",
    });
    expect(resolveEditorTheme("auto", getDefaultTheme(), "light")).toEqual({
      kind: "derived",
      mode: "light",
    });
  });
});
