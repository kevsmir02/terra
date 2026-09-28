import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  formatSearchCount,
  searchQueryError,
  searchToggleForKey,
  type TerminalSearchFlags,
} from "@/modules/terminal/lib/terminalSearch";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { TerminalSearch } from "@/modules/terminal/lib/lazySearch";
import type { ISearchResultChangeEvent } from "@xterm/addon-search";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SearchTarget } from "./SearchInline";

const TERM_DECORATIONS = {
  matchBackground: "#515c6a",
  activeMatchBackground: "#d18616",
  matchOverviewRuler: "#d18616",
  activeMatchColorOverviewRuler: "#d18616",
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

type Props = {
  target: SearchTarget;
  q: string;
  setQ: (q: string) => void;
  flags: TerminalSearchFlags;
  setFlags: (flags: TerminalSearchFlags) => void;
  placeholder: string;
  scopeLabel: string;
  hasDirection: boolean;
  /** Rendered by the eager header so the icon is not split into its own chunk. */
  leadingIcon: ReactNode;
  inputRef: (el: HTMLInputElement | null) => void;
  clearTarget: () => void;
  /** Blur with an empty field: nothing to keep the panel open for. */
  onIdleBlur: () => void;
  /** Escape: clear the target, close and hand focus back to it. */
  onDismiss: () => void;
};

/**
 * The open search panel. Loaded on first open: it is the part of the header
 * search that does work, so the startup graph carries only the button.
 */
export function SearchPanel({
  target,
  q,
  setQ,
  flags,
  setFlags,
  placeholder,
  scopeLabel,
  hasDirection,
  leadingIcon,
  inputRef,
  clearTarget,
  onIdleBlur,
  onDismiss,
}: Props) {
  const localInput = useRef<HTMLInputElement | null>(null);
  const setInput = useCallback(
    (el: HTMLInputElement | null) => {
      localInput.current = el;
      inputRef(el);
    },
    [inputRef],
  );
  const [results, setResults] = useState<ISearchResultChangeEvent | null>(null);

  const isTerminal = target?.kind === "terminal";
  const terminalAddon = isTerminal ? target.addon : null;
  const queryError = isTerminal ? searchQueryError(q, flags) : null;

  // Counted only while the panel is mounted: a closed search holds no listener.
  useEffect(() => {
    setResults(null);
    if (!terminalAddon) return;
    const sub = terminalAddon.onDidChangeResults(setResults);
    return () => sub.dispose();
  }, [terminalAddon]);

  const searchTerminal = (
    addon: TerminalSearch,
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

  const countLabel = isTerminal ? formatSearchCount(q, results) : null;

  return (
    <div className="terra-pop-in absolute top-full right-0 z-50 mt-1.5 w-80 rounded-lg border border-border/(--emph-soft) bg-popover/(--emph-bold) p-1.5 shadow-lg backdrop-blur-md">
      <div className="relative">
        {leadingIcon}
        <Input
          ref={setInput}
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
            if (!q) onIdleBlur();
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
              onDismiss();
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
                localInput.current?.focus();
              }}
              className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
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
            ? "Enter next · Shift+Enter prev · Esc close"
            : "Esc close"}
        </span>
      </div>
    </div>
  );
}
