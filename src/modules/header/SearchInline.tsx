import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEY_SEP } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import {
  DEFAULT_SEARCH_FLAGS,
  formatSearchCount,
  searchQueryError,
  searchToggleForKey,
  type TerminalSearchFlags,
} from "@/modules/terminal/lib/terminalSearch";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  ISearchResultChangeEvent,
  SearchAddon,
} from "@xterm/addon-search";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

const TERM_DECORATIONS = {
  matchBackground: "#515c6a",
  activeMatchBackground: "#d18616",
  matchOverviewRuler: "#d18616",
  activeMatchColorOverviewRuler: "#d18616",
};

export type SearchTarget =
  | { kind: "terminal"; addon: SearchAddon; focus: () => void }
  | { kind: "editor"; handle: EditorPaneHandle; focus: () => void }
  | {
      kind: "git-history";
      handle: { setQuery: (q: string) => void; clearQuery: () => void };
      focus: () => void;
    }
  | null;

export type SearchInlineHandle = { focus: () => void };

type Props = {
  target: SearchTarget;
};

const FLAG_TOGGLES: {
  flag: keyof TerminalSearchFlags;
  glyph: string;
  label: string;
  chord: string;
}[] = [
  { flag: "caseSensitive", glyph: "Aa", label: "Match case", chord: "Alt+C" },
  { flag: "wholeWord", glyph: "ab", label: "Whole word", chord: "Alt+W" },
  { flag: "regex", glyph: ".*", label: "Regular expression", chord: "Alt+R" },
];

export const SearchInline = forwardRef<SearchInlineHandle, Props>(
  function SearchInline({ target }, ref) {
    const [q, setQ] = useState("");
    // The field is a panel over the surface it searches, not a permanent
    // header widget: it opens on the shortcut or the button and closes on
    // Escape, so an empty box never taxes the width the tab strip needs.
    const [open, setOpen] = useState(false);
    const [flags, setFlags] =
      useState<TerminalSearchFlags>(DEFAULT_SEARCH_FLAGS);
    const [results, setResults] = useState<ISearchResultChangeEvent | null>(
      null,
    );
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingFocusRef = useRef(false);
    const setInputRef = useCallback((el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (!el || !pendingFocusRef.current) return;
      pendingFocusRef.current = false;
      el.focus();
    }, []);

    const userShortcuts = usePreferencesStore((s) => s.shortcuts);

    const shortcutText = useMemo(() => {
      const s = SHORTCUTS.find((s) => s.id === "search.focus");
      if (!s) return "";
      const bindings = userShortcuts["search.focus"] || s.defaultBindings;
      if (!bindings || bindings.length === 0) return "";
      const tokens = getBindingTokens(bindings[0]);
      return tokens.join(KEY_SEP);
    }, [userShortcuts]);

    const baseLabel = target?.kind === "git-history" ? "Git search" : "Search";

    // git-history filters the list live, so Enter has no next/prev semantics
    // there; say so rather than advertising a key that does nothing.
    const hasDirection = target?.kind !== "git-history";

    const scopeLabel = useMemo(() => {
      if (!target) return "Nothing to search";
      if (target.kind === "terminal") return "Terminal";
      if (target.kind === "editor") return "Editor";
      return "Commit history";
    }, [target]);

    const placeholder = useMemo(() => {
      return shortcutText ? `${baseLabel} (${shortcutText})` : baseLabel;
    }, [baseLabel, shortcutText]);

    const tooltipTitle = useMemo(() => {
      return shortcutText ? `${baseLabel} (${shortcutText})` : baseLabel;
    }, [baseLabel, shortcutText]);

    const focus = useCallback(() => {
      pendingFocusRef.current = true;
      setOpen(true);
      inputRef.current?.focus();
      if (inputRef.current) pendingFocusRef.current = false;
    }, []);

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const clearTarget = useCallback(() => {
      if (!target) return;
      if (target.kind === "terminal") target.addon.clearDecorations();
      else target.handle.clearQuery();
    }, [target]);

    const restoreTargetFocus = useCallback(() => {
      if (!target) return;
      target.focus();
    }, [target]);

    // Target switched (terminal ↔ editor) or removed → drop highlights.
    useEffect(() => clearTarget, [clearTarget]);

    const isTerminal = target?.kind === "terminal";
    const terminalAddon = isTerminal ? target.addon : null;
    const queryError = isTerminal ? searchQueryError(q, flags) : null;

    // Counted only while the panel is open: a closed search holds no listener.
    useEffect(() => {
      setResults(null);
      if (!open || !terminalAddon) return;
      const sub = terminalAddon.onDidChangeResults(setResults);
      return () => sub.dispose();
    }, [open, terminalAddon]);

    const searchTerminal = (
      addon: SearchAddon,
      query: string,
      nextFlags: TerminalSearchFlags,
      direction: "incremental" | "next" | "prev",
    ) => {
      if (!query || searchQueryError(query, nextFlags)) {
        addon.clearDecorations();
        setResults(null);
        return;
      }
      const opts = {
        ...nextFlags,
        incremental: direction === "incremental",
        decorations: TERM_DECORATIONS,
      };
      if (direction === "prev") addon.findPrevious(query, opts);
      else addon.findNext(query, opts);
    };

    const toggleFlag = (flag: keyof TerminalSearchFlags) => {
      const next = { ...flags, [flag]: !flags[flag] };
      setFlags(next);
      if (target?.kind === "terminal") {
        searchTerminal(target.addon, q, next, "incremental");
      }
    };

    const applyIncremental = (next: string) => {
      if (!target) return;
      if (target.kind === "terminal") {
        searchTerminal(target.addon, next, flags, "incremental");
      } else {
        target.handle.setQuery(next);
      }
    };

    const countLabel = isTerminal ? formatSearchCount(q, results) : null;

    const findDirection = (forward: boolean) => {
      if (!target || !q) return;
      if (target.kind === "terminal") {
        searchTerminal(target.addon, q, flags, forward ? "next" : "prev");
      } else if (target.kind === "editor") {
        if (forward) target.handle.findNext();
        else target.handle.findPrevious();
      }
      // git-history: the list filters live; Enter has no next/prev semantics.
    };

    return (
      <div className="relative h-7 w-7 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          aria-expanded={open}
          className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
          onClick={() => (open ? setOpen(false) : focus())}
          title={tooltipTitle}
        >
          <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.75} />
        </Button>

        {open ? (
          <div className="terra-pop-in absolute top-full right-0 z-50 mt-1.5 w-80 rounded-lg border border-border/(--emph-soft) bg-popover/(--emph-bold) p-1.5 shadow-lg backdrop-blur-md">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                size={13}
                strokeWidth={1.75}
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={setInputRef}
                value={q}
                placeholder={placeholder}
                aria-invalid={queryError ? true : undefined}
                className={cn(
                  "h-7 w-full bg-muted/(--emph-bold) pr-7 pl-7 text-[13px]! placeholder:text-muted-foreground/(--emph-strong) focus-visible:ring-0",
                  isTerminal && "pr-24",
                )}
                onChange={(e) => {
                  const next = e.target.value;
                  setQ(next);
                  applyIncremental(next);
                }}
                onBlur={() => {
                  if (!q) setOpen(false);
                }}
                onKeyDown={(e) => {
                  const toggle = isTerminal ? searchToggleForKey(e) : null;
                  if (toggle) {
                    e.preventDefault();
                    toggleFlag(toggle);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    findDirection(!e.shiftKey);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    clearTarget();
                    setQ("");
                    setOpen(false);
                    restoreTargetFocus();
                  }
                }}
              />
              <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5">
                {q && (
                  <button
                    type="button"
                    onClick={() => {
                      setQ("");
                      clearTarget();
                      setResults(null);
                      inputRef.current?.focus();
                    }}
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      size={11}
                      strokeWidth={2}
                    />
                  </button>
                )}
                {isTerminal
                  ? FLAG_TOGGLES.map((t) => (
                      <button
                        key={t.flag}
                        type="button"
                        aria-pressed={flags[t.flag]}
                        aria-label={`${t.label} (${t.chord})`}
                        title={`${t.label} (${t.chord})`}
                        // Keep focus in the field so the next keystroke still searches.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => toggleFlag(t.flag)}
                        className={cn(
                          "h-5 min-w-5 rounded-sm px-0.5 font-mono text-[10px] leading-none text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:bg-primary/(--emph-soft) aria-pressed:text-foreground",
                          t.flag === "wholeWord" && "underline",
                        )}
                      >
                        {t.glyph}
                      </button>
                    ))
                  : null}
              </div>
            </div>
            <div className="flex items-center gap-2 px-1 pt-1.5 pb-0.5 text-[10px] text-muted-foreground">
              {queryError ? (
                <span role="alert" className="truncate text-destructive">
                  Invalid regex: {queryError}
                </span>
              ) : (
                <>
                  <span className="truncate">{scopeLabel}</span>
                  {countLabel ? (
                    <span
                      aria-live="polite"
                      className="shrink-0 text-foreground tabular-nums"
                    >
                      {countLabel}
                    </span>
                  ) : null}
                </>
              )}
              <span className="ml-auto shrink-0">
                {hasDirection
                  ? "Enter next \u00b7 Shift+Enter prev \u00b7 Esc close"
                  : "Esc close"}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);
