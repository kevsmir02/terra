import { EDITOR_THEMES, type EditorThemeId } from "@/modules/settings/store";
import type { Extension } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { derivedDark, derivedLight } from "./cmThemes";
import { createEditorThemeCache } from "./themes";

type Loaders = Parameters<typeof createEditorThemeCache>[0];

function fakeLoaders(impl: (id: EditorThemeId) => Promise<Extension>): {
  loaders: Loaders;
  calls: EditorThemeId[];
} {
  const calls: EditorThemeId[] = [];
  const loaders = Object.fromEntries(
    EDITOR_THEMES.map((id) => [
      id,
      () => {
        calls.push(id);
        return impl(id);
      },
    ]),
  ) as Loaders;
  return { loaders, calls };
}

describe("editor theme cache", () => {
  it("never loads anything for the engine-derived themes", () => {
    const { loaders, calls } = fakeLoaders(async () => []);
    const cache = createEditorThemeCache(loaders);
    expect(cache.pick({ kind: "derived", mode: "dark" })).toBe(derivedDark);
    expect(cache.pick({ kind: "derived", mode: "light" })).toBe(derivedLight);
    expect(calls).toEqual([]);
  });

  it("fetches a preset once however many editors ask for it", async () => {
    const nord: Extension = [];
    const { loaders, calls } = fakeLoaders(async () => nord);
    const cache = createEditorThemeCache(loaders);
    const first = cache.pick({ kind: "preset", id: "nord" });
    const second = cache.pick({ kind: "preset", id: "nord" });
    expect(first).toBeInstanceOf(Promise);
    expect(second).toBe(first);
    await first;
    expect(cache.pick({ kind: "preset", id: "nord" })).toBe(nord);
    expect(calls).toEqual(["nord"]);
  });

  it("keeps the last applied theme available while a switch is loading", async () => {
    const { loaders } = fakeLoaders(async () => []);
    const cache = createEditorThemeCache(loaders);
    expect(cache.lastReady()).toBeNull();
    cache.pick({ kind: "derived", mode: "dark" });
    const pending = cache.pick({ kind: "preset", id: "dracula" });
    expect(pending).toBeInstanceOf(Promise);
    expect(cache.lastReady()).toBe(derivedDark);
    await pending;
  });

  it("degrades a failed load to the derived theme of the same mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loaders, calls } = fakeLoaders(() =>
      Promise.reject(new Error("chunk missing")),
    );
    const cache = createEditorThemeCache(loaders);
    await expect(
      cache.pick({ kind: "preset", id: "github-light" }),
    ).resolves.toBe(derivedLight);
    await expect(cache.pick({ kind: "preset", id: "nord" })).resolves.toBe(
      derivedDark,
    );
    expect(cache.pick({ kind: "preset", id: "nord" })).toBe(derivedDark);
    expect(calls).toEqual(["github-light", "nord"]);
    warn.mockRestore();
  });
});
