import { describe, expect, it } from "vitest";
import { resolveEditorTheme } from "./resolveEditorTheme";
import type { Theme } from "./types";

const ansi = Array.from({ length: 16 }, (_, i) =>
  `#${(i * 16).toString(16).padStart(2, "0").repeat(3)}`,
) as unknown as never;

const noAnsi: Theme = {
  id: "no-ansi",
  name: "No Ansi",
  editorTheme: { dark: "dracula", light: "github-light" },
  variants: { dark: {}, light: {} },
};

const withAnsi: Theme = {
  id: "with-ansi",
  name: "With Ansi",
  editorTheme: { dark: "dracula", light: "github-light" },
  variants: {
    dark: { colors: { background: "#000000", foreground: "#ffffff" }, terminal: { ansi } },
    light: { colors: { background: "#ffffff", foreground: "#000000" }, terminal: { ansi } },
  },
};

const darkOnly: Theme = {
  id: "dark-only",
  name: "Dark Only",
  variants: {
    dark: { colors: { background: "#000000", foreground: "#ffffff" }, terminal: { ansi } },
  },
};

// No ansi palette and only a dark pairing, so the cross-mode fallback inside the
// editorTheme chain is the only thing that can resolve light mode. Without a
// theme shaped like this, deleting that fallback passes every other test.
const asymmetricPairing: Theme = {
  id: "asymmetric-pairing",
  name: "Asymmetric Pairing",
  editorTheme: { dark: "dracula" },
  variants: { dark: {}, light: {} },
};

describe("resolveEditorTheme", () => {
  it("returns an explicit pref as a preset, ignoring the app theme", () => {
    expect(resolveEditorTheme("nord", "with-ansi", [withAnsi], "dark")).toEqual({
      kind: "preset",
      id: "nord",
    });
  });

  it("derives when the theme has an ansi palette, outranking editorTheme", () => {
    expect(resolveEditorTheme("auto", "with-ansi", [withAnsi], "dark")).toEqual({
      kind: "derived",
      mode: "dark",
    });
    expect(resolveEditorTheme("auto", "with-ansi", [withAnsi], "light")).toEqual({
      kind: "derived",
      mode: "light",
    });
  });

  // The variant that supplied the colours decides the frame, so a dark-only
  // theme in light mode must not mount a light editor over dark syntax.
  it("reports the winning variant mode for a single-variant theme", () => {
    expect(resolveEditorTheme("auto", "dark-only", [darkOnly], "light")).toEqual({
      kind: "derived",
      mode: "dark",
    });
  });

  // Pins the cross-mode fallback inside the pairing chain. A mutant reducing it
  // to `theme.editorTheme?.[mode]` passes every other test in this file.
  it("falls back across modes within the editorTheme pairing", () => {
    expect(
      resolveEditorTheme("auto", "asymmetric-pairing", [asymmetricPairing], "light"),
    ).toEqual({ kind: "preset", id: "dracula" });
  });

  it("falls through to the editorTheme pairing without an ansi palette", () => {
    expect(resolveEditorTheme("auto", "no-ansi", [noAnsi], "dark")).toEqual({
      kind: "preset",
      id: "dracula",
    });
    expect(resolveEditorTheme("auto", "no-ansi", [noAnsi], "light")).toEqual({
      kind: "preset",
      id: "github-light",
    });
  });

  // terra-default authors its own ansi palette, so derivation outranks the
  // atomone pairing it still declares as a fallback. Before it did, the default
  // theme was the one case where the editor came from an unrelated preset.
  it("derives terra-default from its own ansi palette", () => {
    expect(resolveEditorTheme("auto", "terra-default", [], "dark")).toEqual({
      kind: "derived",
      mode: "dark",
    });
    expect(resolveEditorTheme("auto", "terra-default", [], "light")).toEqual({
      kind: "derived",
      mode: "light",
    });
  });

  it("uses the default theme resolution for an unknown app theme", () => {
    expect(resolveEditorTheme("auto", "does-not-exist", [], "dark")).toEqual({
      kind: "derived",
      mode: "dark",
    });
  });

  it("falls back to a neutral preset when the pairing is invalid", () => {
    const bad: Theme = {
      id: "bad",
      name: "Bad",
      editorTheme: { dark: "not-a-real-theme" },
      variants: { dark: {} },
    };
    expect(resolveEditorTheme("auto", "bad", [bad], "dark")).toEqual({
      kind: "preset",
      id: "atomone",
    });
    expect(resolveEditorTheme("auto", "bad", [bad], "light")).toEqual({
      kind: "preset",
      id: "github-light",
    });
  });
});
