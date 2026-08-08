import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens";
import { STATUS_ROLES, SYNTAX_ROLES } from "./types";

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

  it("documents every token", () => {
    for (const t of TOKENS) expect(t.doc.length).toBeGreaterThan(0);
  });

  it("declares the emphasis ladder with its modal defaults", () => {
    const ladder = TOKENS.filter((t) => t.group === "emphasis");
    expect(ladder.map((t) => [t.cssVar, t.fallback])).toEqual([
      ["--emph-faint", "0.1"],
      ["--emph-subtle", "0.3"],
      ["--emph-soft", "0.4"],
      ["--emph-medium", "0.5"],
      ["--emph-strong", "0.6"],
      ["--emph-bold", "0.85"],
    ]);
  });
});
