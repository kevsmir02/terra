import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { operationBanner } from "./repoOperation";

describe("operationBanner", () => {
  it("blocks Continue while any conflict remains", () => {
    expect(operationBanner("merge", 1).continueBlocked).not.toBeNull();
    expect(operationBanner("rebase", 3).detail).toBe("3 conflicts to resolve");
  });

  it("allows Continue once every conflict is resolved", () => {
    const view = operationBanner("cherry-pick", 0);
    expect(view.continueBlocked).toBeNull();
    expect(view.title).toBe("Cherry-pick in progress");
  });
});
