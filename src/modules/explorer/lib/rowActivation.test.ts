import { describe, expect, it } from "vitest";
import { rowActivation } from "./rowActivation";

describe("rowActivation", () => {
  it("single click toggles a folder in both modes", () => {
    expect(rowActivation("click", true, false)).toBe("toggle");
    expect(rowActivation("click", true, true)).toBe("toggle");
  });

  it("double click on a folder does nothing in either mode", () => {
    expect(rowActivation("dblclick", true, false)).toBe("none");
    expect(rowActivation("dblclick", true, true)).toBe("none");
  });

  it("single click opens a file as a preview by default", () => {
    expect(rowActivation("click", false, false)).toBe("open-preview");
  });

  it("double click renames a file by default", () => {
    expect(rowActivation("dblclick", false, false)).toBe("rename");
  });

  it("single click only selects a file when open on double click is on", () => {
    expect(rowActivation("click", false, true)).toBe("none");
  });

  it("double click opens a pinned tab when open on double click is on", () => {
    expect(rowActivation("dblclick", false, true)).toBe("open");
  });
});
