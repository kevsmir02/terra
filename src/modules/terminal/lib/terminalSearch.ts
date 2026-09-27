export type TerminalSearchFlags = {
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
};

export const DEFAULT_SEARCH_FLAGS: TerminalSearchFlags = {
  caseSensitive: false,
  regex: false,
  wholeWord: false,
};

/** xterm's SearchAddon stops counting here (its `highlightLimit` default). */
export const SEARCH_RESULT_LIMIT = 1000;

/**
 * Why a query cannot be searched, or null. SearchAddon hands a regex query
 * straight to `RegExp`, so an invalid one would throw out of `findNext`.
 */
export function searchQueryError(
  query: string,
  flags: TerminalSearchFlags,
): string | null {
  if (!flags.regex || query === "") return null;
  try {
    new RegExp(query, flags.caseSensitive ? "g" : "gi");
    return null;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return detail.replace(/^Invalid regular expression:\s*/i, "") || "Invalid";
  }
}

/** "3/17", "?/17" before a match is selected, "No results", or null. */
export function formatSearchCount(
  query: string,
  result: { resultIndex: number; resultCount: number } | null,
): string | null {
  if (!query || !result) return null;
  if (result.resultCount <= 0) return "No results";
  const total =
    result.resultCount >= SEARCH_RESULT_LIMIT
      ? `${SEARCH_RESULT_LIMIT}+`
      : String(result.resultCount);
  const index = result.resultIndex >= 0 ? String(result.resultIndex + 1) : "?";
  return `${index}/${total}`;
}

const TOGGLE_CODES: Record<string, keyof TerminalSearchFlags> = {
  KeyC: "caseSensitive",
  KeyR: "regex",
  KeyW: "wholeWord",
};

/**
 * The flag an Alt chord flips while the search field has focus. Matched on
 * the physical key so a layout that rewrites Alt+letter still reaches it.
 */
export function searchToggleForKey(e: {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): keyof TerminalSearchFlags | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  return TOGGLE_CODES[e.code] ?? null;
}
