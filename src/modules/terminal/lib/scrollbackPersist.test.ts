import { describe, expect, it } from "vitest";
import {
  capScrollback,
  peekRestoredScrollback,
  stashRestoredScrollback,
  takeRestoredScrollback,
} from "./scrollbackPersist";

describe("capScrollback", () => {
  it("returns short text unchanged", () => {
    expect(capScrollback("a\r\nb", 100)).toBe("a\r\nb");
  });

  it("keeps the tail from a line boundary and resets attributes first", () => {
    const text = "one\r\ntwo\r\nthree\r\nfour";
    expect(capScrollback(text, 12)).toBe("\x1b[0mthree\r\nfour");
  });

  it("cuts at the limit when no line boundary is near", () => {
    expect(capScrollback("abcdefghij", 4)).toBe("\x1b[0mghij");
  });

  it("drops empty text", () => {
    expect(capScrollback("", 10)).toBeNull();
    expect(capScrollback("   \r\n", 10)).toBeNull();
  });
});

describe("restored scrollback stash", () => {
  it("hands a stashed buffer out once and lets a peek read it without consuming", () => {
    stashRestoredScrollback(7, "old");
    expect(peekRestoredScrollback(7)).toBe("old");
    expect(takeRestoredScrollback(7)).toBe("old");
    expect(takeRestoredScrollback(7)).toBeNull();
    expect(peekRestoredScrollback(7)).toBeNull();
  });
});
