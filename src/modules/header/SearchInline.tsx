import { Button } from "@/components/ui/button";
import { KEY_SEP } from "@/lib/platform";
import type { EditorPaneHandle } from "@/modules/editor";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import type { TerminalSearch } from "@/modules/terminal/lib/lazySearch";
import type { TerminalSearchFlags } from "@/modules/terminal/lib/terminalSearch";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

const SearchPanel = lazy(() =>
  import("./SearchPanel").then((m) => ({ default: m.SearchPanel })),
);

const NO_FLAGS: TerminalSearchFlags = {
  caseSensitive: false,
  regex: false,
  wholeWord: false,
};

export type SearchTarget =
  | { kind: "terminal"; addon: TerminalSearch; focus: () => void }
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

export const SearchInline = forwardRef<SearchInlineHandle, Props>(
  function SearchInline({ target }, ref) {
    const [q, setQ] = useState("");
    // The field is a panel over the surface it searches, not a permanent
    // header widget: it opens on the shortcut or the button and closes on
    // Escape, so an empty box never taxes the width the tab strip needs.
    const [open, setOpen] = useState(false);
    const [flags, setFlags] = useState<TerminalSearchFlags>(NO_FLAGS);
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

    // Target switched (terminal ↔ editor) or removed → drop highlights.
    useEffect(() => clearTarget, [clearTarget]);

    const dismiss = useCallback(() => {
      clearTarget();
      setQ("");
      setOpen(false);
      target?.focus();
    }, [clearTarget, target]);

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
          <Suspense fallback={null}>
            <SearchPanel
              target={target}
              q={q}
              setQ={setQ}
              flags={flags}
              setFlags={setFlags}
              placeholder={placeholder}
              scopeLabel={scopeLabel}
              hasDirection={hasDirection}
              leadingIcon={
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={13}
                  strokeWidth={1.75}
                  className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
                />
              }
              inputRef={setInputRef}
              clearTarget={clearTarget}
              onIdleBlur={() => setOpen(false)}
              onDismiss={dismiss}
            />
          </Suspense>
        ) : null}
      </div>
    );
  },
);
