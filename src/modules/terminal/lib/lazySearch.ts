import type {
  ISearchOptions,
  ISearchResultChangeEvent,
  SearchAddon,
} from "@xterm/addon-search";
import type { ITerminalAddon } from "@xterm/xterm";

/** What the header search needs from a terminal, without the addon loaded. */
export type TerminalSearch = {
  findNext(query: string, options?: ISearchOptions): void;
  findPrevious(query: string, options?: ISearchOptions): void;
  clearDecorations(): void;
  onDidChangeResults(listener: (e: ISearchResultChangeEvent) => void): {
    dispose(): void;
  };
};

export type SearchAddonModule = { SearchAddon: new () => SearchAddon };

type AddonHost = { loadAddon(addon: ITerminalAddon): void };

const loadSearchModule = (): Promise<SearchAddonModule> =>
  import("@xterm/addon-search");

/**
 * A slot's search, with xterm's SearchAddon fetched on the first query rather
 * than at startup. Only the latest query waits for the load: typing ahead
 * replaces it, and clearing before the load lands drops it.
 */
export function createLazySearch(
  term: AddonHost,
  load: () => Promise<SearchAddonModule> = loadSearchModule,
): TerminalSearch {
  let addon: SearchAddon | null = null;
  let loading = false;
  let pending: ((a: SearchAddon) => void) | null = null;
  const listeners = new Set<(e: ISearchResultChangeEvent) => void>();

  const ensureLoaded = () => {
    if (loading) return;
    loading = true;
    load()
      .then((m) => {
        const a = new m.SearchAddon();
        term.loadAddon(a);
        a.onDidChangeResults((e) => {
          for (const l of listeners) l(e);
        });
        addon = a;
        const op = pending;
        pending = null;
        op?.(a);
      })
      .catch((e) => {
        // A disposed terminal or a failed fetch: the next query retries.
        loading = false;
        pending = null;
        console.warn("[terra] search addon unavailable:", e);
      });
  };

  const run = (op: (a: SearchAddon) => void) => {
    if (addon) {
      op(addon);
      return;
    }
    pending = op;
    ensureLoaded();
  };

  return {
    findNext: (query, options) => run((a) => a.findNext(query, options)),
    findPrevious: (query, options) =>
      run((a) => a.findPrevious(query, options)),
    clearDecorations: () => {
      pending = null;
      addon?.clearDecorations();
    },
    onDidChangeResults: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}
