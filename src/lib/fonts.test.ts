import { describe, expect, it } from "vitest";
import {
  migrateTerminalFont,
  primaryFamily,
  resolveFontFamily,
  resolveTerminalFont,
} from "./fonts";

const FALLBACK =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", monospace';

describe("resolveFontFamily", () => {
  it("quotes a bare family and appends the mono fallback", () => {
    expect(resolveFontFamily("JetBrainsMono Nerd Font")).toBe(
      `"JetBrainsMono Nerd Font", ${FALLBACK}`,
    );
  });

  it("does not double-quote an already-quoted family", () => {
    expect(resolveFontFamily('"Fira Code"')).toBe(`"Fira Code", ${FALLBACK}`);
  });

  it("passes a comma-separated stack through and still appends fallback", () => {
    expect(resolveFontFamily("Foo, Bar")).toBe(`Foo, Bar, ${FALLBACK}`);
  });

  it("strips stray internal quotes to avoid a malformed token", () => {
    expect(resolveFontFamily('Foo"Bar')).toBe(`"FooBar", ${FALLBACK}`);
  });

  it("trims surrounding whitespace before quoting", () => {
    expect(resolveFontFamily("  Hack Nerd Font  ")).toBe(
      `"Hack Nerd Font", ${FALLBACK}`,
    );
  });

  it("falls back to the mono chain for empty input", () => {
    expect(resolveFontFamily("")).toBe(FALLBACK);
    expect(resolveFontFamily("   ")).toBe(FALLBACK);
  });
});

describe("resolveTerminalFont", () => {
  it("uses the bundled JetBrainsMono stack by default", () => {
    expect(resolveTerminalFont("jetbrains-mono", "")).toBe(FALLBACK);
  });

  it("puts a bundled family ahead of the JetBrainsMono fallback", () => {
    expect(resolveTerminalFont("fira-code", "")).toBe(
      `"FiraCode Nerd Font Mono", ${FALLBACK}`,
    );
    expect(resolveTerminalFont("cascadia-code", "")).toBe(
      `"CaskaydiaCove Nerd Font Mono", ${FALLBACK}`,
    );
  });

  it("ignores the custom family unless the system font is selected", () => {
    expect(resolveTerminalFont("fira-code", "Hack")).toBe(
      `"FiraCode Nerd Font Mono", ${FALLBACK}`,
    );
  });

  it("resolves a system font through the custom family", () => {
    expect(resolveTerminalFont("system", "Hack Nerd Font")).toBe(
      `"Hack Nerd Font", ${FALLBACK}`,
    );
  });

  it("falls back to JetBrainsMono for an unknown id or an empty family", () => {
    expect(resolveTerminalFont("system", "")).toBe(FALLBACK);
    expect(resolveTerminalFont("bogus", "")).toBe(FALLBACK);
  });
});

describe("primaryFamily", () => {
  it("returns the first family of a stack without quotes", () => {
    expect(
      primaryFamily(
        '"FiraCode Nerd Font Mono", "JetBrainsMono Nerd Font Mono", monospace',
      ),
    ).toBe("FiraCode Nerd Font Mono");
    expect(primaryFamily("Foo, Bar")).toBe("Foo");
  });
});

describe("migrateTerminalFont", () => {
  it("keeps a stored id", () => {
    expect(migrateTerminalFont("fira-code", "")).toBe("fira-code");
    expect(migrateTerminalFont("system", "")).toBe("system");
  });

  it("treats a family typed before the picker existed as the system choice", () => {
    expect(migrateTerminalFont(undefined, "Hack")).toBe("system");
  });

  it("defaults to JetBrainsMono otherwise", () => {
    expect(migrateTerminalFont(undefined, "")).toBe("jetbrains-mono");
    expect(migrateTerminalFont("bogus", "  ")).toBe("jetbrains-mono");
  });
});
