import { describe, expect, it } from "vitest";
import { BELL_WINDOW_MS, bellAllowed } from "./bellGate";

describe("bellAllowed", () => {
  it("lets the first bell of a leaf through and throttles the next", () => {
    const seen = new Map<number, number>();
    expect(bellAllowed(seen, 1, 1000)).toBe(true);
    expect(bellAllowed(seen, 1, 1000 + BELL_WINDOW_MS - 1)).toBe(false);
    expect(bellAllowed(seen, 1, 1000 + BELL_WINDOW_MS)).toBe(true);
  });

  it("keeps a window per leaf", () => {
    const seen = new Map<number, number>();
    expect(bellAllowed(seen, 1, 1000)).toBe(true);
    expect(bellAllowed(seen, 2, 1000)).toBe(true);
  });
});
