import { describe, expect, it } from "vitest";
import { outputRange, stepCommandLine } from "./commandMarks";

describe("stepCommandLine", () => {
  const lines = [0, 10, 25];

  it("steps to the nearest command above the viewport top", () => {
    expect(stepCommandLine(lines, 12, -1)).toBe(10);
    expect(stepCommandLine(lines, 10, -1)).toBe(0);
  });

  it("steps to the nearest command below the viewport top", () => {
    expect(stepCommandLine(lines, 12, 1)).toBe(25);
    expect(stepCommandLine(lines, 0, 1)).toBe(10);
  });

  it("returns null at either end or with no commands", () => {
    expect(stepCommandLine(lines, 0, -1)).toBeNull();
    expect(stepCommandLine(lines, 25, 1)).toBeNull();
    expect(stepCommandLine([], 5, -1)).toBeNull();
  });

  it("ignores markers that scrolled out of the buffer", () => {
    expect(stepCommandLine([-1, 10], 5, -1)).toBeNull();
  });
});

describe("outputRange", () => {
  it("spans from the command start to the line before the end marker", () => {
    expect(outputRange(4, 9, 50)).toEqual([4, 8]);
  });

  it("runs to the end of the buffer while the command is still running", () => {
    expect(outputRange(4, null, 50)).toEqual([4, 49]);
  });

  it("is empty when the command printed nothing or markers are gone", () => {
    expect(outputRange(4, 4, 50)).toBeNull();
    expect(outputRange(-1, 4, 50)).toBeNull();
    expect(outputRange(null, 4, 50)).toBeNull();
  });
});
