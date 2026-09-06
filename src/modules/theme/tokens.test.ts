import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKEN_DOCS } from "./tokenDocs";
import { TOKENS } from "./tokens";
import { STATUS_ROLES, SYNTAX_ROLES } from "./types";
// @ts-expect-error script is mjs
import { renderTokenReference } from "@/../scripts/theme-token-reference.mjs";

describe("token registry", () => {
  it("maps each CSS variable exactly once", () => {
    const vars = TOKENS.map((t) => t.cssVar);
    expect(new Set(vars).size).toBe(vars.length);
  });

  it("uses each token key exactly once", () => {
    const keys = TOKENS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every syntax and status role", () => {
    for (const role of SYNTAX_ROLES) {
      expect(TOKENS.some((t) => t.key === `syntax.${role}`)).toBe(true);
    }
    for (const role of STATUS_ROLES) {
      expect(TOKENS.some((t) => t.key === `status.${role}`)).toBe(true);
    }
  });

  it("declares only dependencies that exist", () => {
    const keys = new Set(TOKENS.map((t) => t.key));
    for (const t of TOKENS) {
      for (const d of t.deps ?? []) expect(keys.has(d)).toBe(true);
    }
  });

  it("has an acyclic dependency graph", () => {
    const byKey = new Map(TOKENS.map((t) => [t.key, t]));
    const state = new Map<string, "open" | "done">();
    const visit = (key: string, trail: string[]): void => {
      if (state.get(key) === "done") return;
      if (state.get(key) === "open") {
        throw new Error(`cycle: ${[...trail, key].join(" -> ")}`);
      }
      state.set(key, "open");
      for (const d of byKey.get(key)?.deps ?? []) visit(d, [...trail, key]);
      state.set(key, "done");
    };
    expect(() => {
      for (const t of TOKENS) visit(t.key, []);
    }).not.toThrow();
  });

  it("documents every token, and documents nothing else", () => {
    const keys = new Set(TOKENS.map((t) => t.key));
    for (const t of TOKENS) {
      expect(TOKEN_DOCS[t.key], `${t.key} doc`).toBeTruthy();
    }
    for (const key of Object.keys(TOKEN_DOCS)) {
      expect(keys.has(key), `${key} documents no token`).toBe(true);
    }
  });

  it("declares the emphasis ladder with its modal defaults", () => {
    const ladder = TOKENS.filter((t) => t.group === "emphasis");
    expect(ladder.map((t) => [t.cssVar, t.fallback])).toEqual([
      ["--emph-faint", "10%"],
      ["--emph-subtle", "30%"],
      ["--emph-soft", "40%"],
      ["--emph-medium", "50%"],
      ["--emph-strong", "60%"],
      ["--emph-bold", "85%"],
    ]);
  });

  // Regression guard. These values are substituted into
  // `color-mix(in oklab, <color> <value>, transparent)`, and that slot requires
  // a <percentage>. A bare number like "0.6" is invalid CSS, so the declaration
  // is dropped and every laddered border silently renders at full opacity. The
  // ladder shipped inert exactly once because nothing asserted this.
  it("expresses every alpha token as a percentage, never a bare number", () => {
    for (const t of TOKENS.filter((x) => x.kind === "alpha")) {
      expect(t.fallback, `${t.key} fallback`).toMatch(/^\d+(\.\d+)?%$/);
    }
  });

  it("keeps the THEME.md token reference in sync with the registry", () => {
    const doc = readFileSync("THEME.md", "utf8");
    expect(doc).toContain(renderTokenReference(TOKENS, TOKEN_DOCS));
  });
});
