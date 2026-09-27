import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_FLAGS,
  formatSearchCount,
  SEARCH_RESULT_LIMIT,
  searchQueryError,
  searchToggleForKey,
} from "./terminalSearch";

const regex = { ...DEFAULT_SEARCH_FLAGS, regex: true };

describe("searchQueryError", () => {
  it("rejects a pattern RegExp would throw on", () => {
    expect(searchQueryError("foo(", regex)).not.toBeNull();
    expect(searchQueryError("[a-", regex)).not.toBeNull();
    expect(searchQueryError("*x", regex)).not.toBeNull();
  });

  it("never rejects a literal query, however it is spelled", () => {
    expect(searchQueryError("foo(", DEFAULT_SEARCH_FLAGS)).toBeNull();
    expect(searchQueryError("[a-", DEFAULT_SEARCH_FLAGS)).toBeNull();
  });

  it("accepts an empty or valid pattern", () => {
    expect(searchQueryError("", regex)).toBeNull();
    expect(searchQueryError("^err(or)?\\b", regex)).toBeNull();
  });
});

describe("formatSearchCount", () => {
  it("renders position over total", () => {
    expect(formatSearchCount("x", { resultIndex: 2, resultCount: 17 })).toBe(
      "3/17",
    );
  });

  it("marks an unselected match and an empty result", () => {
    expect(formatSearchCount("x", { resultIndex: -1, resultCount: 4 })).toBe(
      "?/4",
    );
    expect(formatSearchCount("x", { resultIndex: -1, resultCount: 0 })).toBe(
      "No results",
    );
  });

  it("says the count is capped once the addon stops counting", () => {
    expect(
      formatSearchCount("x", {
        resultIndex: 0,
        resultCount: SEARCH_RESULT_LIMIT,
      }),
    ).toBe(`1/${SEARCH_RESULT_LIMIT}+`);
  });

  it("shows nothing without a query or a result", () => {
    expect(
      formatSearchCount("", { resultIndex: 0, resultCount: 3 }),
    ).toBeNull();
    expect(formatSearchCount("x", null)).toBeNull();
  });
});

describe("searchToggleForKey", () => {
  const key = (code: string, mods: Partial<Record<string, boolean>> = {}) => ({
    code,
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });

  it("maps Alt+C, Alt+R and Alt+W to their flags", () => {
    expect(searchToggleForKey(key("KeyC"))).toBe("caseSensitive");
    expect(searchToggleForKey(key("KeyR"))).toBe("regex");
    expect(searchToggleForKey(key("KeyW"))).toBe("wholeWord");
  });

  it("ignores the same letter without Alt or with another modifier", () => {
    expect(searchToggleForKey(key("KeyC", { altKey: false }))).toBeNull();
    expect(searchToggleForKey(key("KeyC", { ctrlKey: true }))).toBeNull();
    expect(searchToggleForKey(key("KeyW", { shiftKey: true }))).toBeNull();
    expect(searchToggleForKey(key("KeyX"))).toBeNull();
  });
});
