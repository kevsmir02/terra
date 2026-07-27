import { describe, expect, it, vi } from "vitest";

// shortcuts.ts reads IS_MAC and MOD_PROP at module scope, so the macOS table
// only exists under a mocked platform module plus a fresh import. Same pattern
// as src/modules/terminal/lib/quoteShellPath.test.ts.
vi.mock("@/lib/platform", () => ({ IS_MAC: true, MOD_PROP: "meta" as const }));

async function load() {
  vi.resetModules();
  const [shortcuts, conflicts] = await Promise.all([
    import("../shortcuts"),
    import("./shortcutConflicts"),
  ]);
  return { ...shortcuts, ...conflicts };
}

describe("macOS default table", () => {
  it("ships no conflicting defaults", async () => {
    const { SHORTCUTS, conflictingShortcuts } = await load();
    for (const s of SHORTCUTS) {
      for (const b of s.defaultBindings) {
        expect(conflictingShortcuts(b, s.id, {})).toEqual([]);
      }
    }
  });

  it("leaves terminal copy and paste unassigned so ⌘C/⌘V stay native", async () => {
    const { SHORTCUTS } = await load();
    expect(
      SHORTCUTS.find((s) => s.id === "terminal.copy")?.defaultBindings,
    ).toEqual([]);
    expect(
      SHORTCUTS.find((s) => s.id === "terminal.paste")?.defaultBindings,
    ).toEqual([]);
  });

  it("still binds newline to Shift+Enter", async () => {
    const { SHORTCUTS } = await load();
    expect(
      SHORTCUTS.find((s) => s.id === "terminal.newline")?.defaultBindings,
    ).toEqual([{ shift: true, key: "Enter" }]);
  });
});
