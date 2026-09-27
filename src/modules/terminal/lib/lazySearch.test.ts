import type { ISearchResultChangeEvent } from "@xterm/addon-search";
import { describe, expect, it, vi } from "vitest";
import { createLazySearch, type SearchAddonModule } from "./lazySearch";

type Call = [string, string?];

function fakeModule() {
  const calls: Call[] = [];
  let fire: ((e: ISearchResultChangeEvent) => void) | null = null;
  class SearchAddon {
    activate() {}
    dispose() {}
    findNext(q: string) {
      calls.push(["next", q]);
      return true;
    }
    findPrevious(q: string) {
      calls.push(["prev", q]);
      return true;
    }
    clearDecorations() {
      calls.push(["clear"]);
    }
    onDidChangeResults(l: (e: ISearchResultChangeEvent) => void) {
      fire = l;
      return { dispose() {} };
    }
  }
  const mod = { SearchAddon } as unknown as SearchAddonModule;
  return { mod, calls, fire: (e: ISearchResultChangeEvent) => fire?.(e) };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const host = () => ({ loadAddon: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createLazySearch", () => {
  it("loads nothing until the first query", () => {
    const load = vi.fn();
    const search = createLazySearch(host(), load);
    search.clearDecorations();
    search.onDidChangeResults(() => {});
    expect(load).not.toHaveBeenCalled();
  });

  it("loads once and runs only the latest query typed during the load", async () => {
    const { mod, calls } = fakeModule();
    const d = deferred<SearchAddonModule>();
    const load = vi.fn(() => d.promise);
    const term = host();
    const search = createLazySearch(term, load);
    search.findNext("a");
    search.findNext("ab");
    search.findPrevious("abc");
    d.resolve(mod);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([["prev", "abc"]]);
    search.findNext("abc");
    expect(calls).toEqual([
      ["prev", "abc"],
      ["next", "abc"],
    ]);
  });

  it("drops a pending query cleared before the load lands", async () => {
    const { mod, calls } = fakeModule();
    const d = deferred<SearchAddonModule>();
    const search = createLazySearch(host(), () => d.promise);
    search.findNext("x");
    search.clearDecorations();
    d.resolve(mod);
    await flush();
    expect(calls).toEqual([]);
  });

  it("forwards result counts to listeners registered before the load", async () => {
    const { mod, fire } = fakeModule();
    const search = createLazySearch(host(), async () => mod);
    const seen: ISearchResultChangeEvent[] = [];
    const sub = search.onDidChangeResults((e) => seen.push(e));
    search.findNext("x");
    await flush();
    fire({ resultIndex: 0, resultCount: 2 });
    sub.dispose();
    fire({ resultIndex: 1, resultCount: 2 });
    expect(seen).toEqual([{ resultIndex: 0, resultCount: 2 }]);
  });

  it("retries after a failed load instead of staying dead", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { mod, calls } = fakeModule();
    const load = vi
      .fn<() => Promise<SearchAddonModule>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(mod);
    const search = createLazySearch(host(), load);
    search.findNext("x");
    await flush();
    expect(calls).toEqual([]);
    search.findNext("y");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([["next", "y"]]);
    warn.mockRestore();
  });
});
