import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(path.join(here, "App.tsx"), "utf8");
const bootSrc = readFileSync(
  path.join(here, "../modules/spaces/lib/useSpacesBoot.ts"),
  "utf8",
);

/**
 * Regression guard for a bug that made every main-window preference stale.
 *
 * `usePreferencesStore.init()` both loads persisted values AND subscribes to
 * `onPreferencesChange`, which is how a write in the separate settings window
 * reaches the main window. Hydration used to live only inside useSpacesBoot's
 * `if (spaces.length === 0)` first-run branch, which early-returns, so every
 * user past their first launch ran the whole main window on
 * DEFAULT_PREFERENCES and never received cross-window updates. Theming masked
 * it by calling `loadPreferences()` directly, and the remaining defaults were
 * benign enough that nobody noticed until a feature depended on a toggle.
 */
describe("main window preference hydration", () => {
  it("hydrates the preferences store at app mount", () => {
    expect(appSrc).toMatch(/usePreferencesStore\s*\.getState\(\)\s*\.init\(\)/);
  });

  it("does not rely on the first-run branch as its only hydration point", () => {
    const branchStart = bootSrc.indexOf("if (spaces.length === 0)");
    expect(branchStart).toBeGreaterThan(-1);
    const beforeBranch = bootSrc.slice(0, branchStart);
    const insideBranch = bootSrc.slice(branchStart);

    // If useSpacesBoot still hydrates, it must not be exclusively inside the
    // first-run branch, either it moved above the branch, or App.tsx covers it.
    const hydratesInsideBranch = /\.init\(\)/.test(insideBranch);
    const hydratesBeforeBranch = /\.init\(\)/.test(beforeBranch);
    const appHydrates =
      /usePreferencesStore\s*\.getState\(\)\s*\.init\(\)/.test(appSrc);

    expect(hydratesBeforeBranch || appHydrates).toBe(true);
    // The branch-local call may remain, init() is idempotent via initPromise.
    expect(hydratesInsideBranch || hydratesBeforeBranch || appHydrates).toBe(
      true,
    );
  });
});
