import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { Diagnostic } from "./diagnostics";
import type { Theme } from "./types";
import { validateTheme } from "./validateTheme";

const STORE_PATH = "terra-custom-themes.json";
const KEY = "themes";
const CHANGED_EVENT = "terra://custom-themes-changed";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export interface SanitizedStoredThemes {
  themes: Theme[];
  rejected: { id: string; diagnostics: Diagnostic[] }[];
}

export function sanitizeStoredThemes(raw: unknown): SanitizedStoredThemes {
  if (!Array.isArray(raw)) return { themes: [], rejected: [] };
  const themes: Theme[] = [];
  const rejected: { id: string; diagnostics: Diagnostic[] }[] = [];
  for (const entry of raw) {
    const result = validateTheme(entry);
    if (result.ok) {
      themes.push(result.theme);
    } else {
      let id = "unknown";
      if (entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string") {
        id = entry.id;
      }
      rejected.push({ id, diagnostics: result.diagnostics });
    }
  }
  return { themes, rejected };
}

export async function listCustomThemesWithDiagnostics(): Promise<SanitizedStoredThemes> {
  return sanitizeStoredThemes(await store.get<unknown>(KEY));
}

export async function listCustomThemes(): Promise<Theme[]> {
  return (await listCustomThemesWithDiagnostics()).themes;
}

export async function saveCustomTheme(theme: Theme): Promise<void> {
  const current = await listCustomThemes();
  const next = current.filter((t) => t.id !== theme.id).concat(theme);
  await store.set(KEY, next);
  await store.save();
  await emit(CHANGED_EVENT);
}

export async function deleteCustomTheme(id: string): Promise<void> {
  const raw = await store.get<unknown>(KEY);
  if (!Array.isArray(raw)) return;
  const next = raw.filter((entry) => {
    if (entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string") {
      return entry.id !== id;
    }
    return id !== "unknown";
  });
  if (next.length === raw.length) return;
  await store.set(KEY, next);
  await store.save();
  await emit(CHANGED_EVENT);
}

export async function onCustomThemesChange(cb: () => void): Promise<UnlistenFn> {
  const unsubLocal = await store.onChange((key) => {
    if (key === KEY) cb();
  });
  const unsubEvent = await listen(CHANGED_EVENT, () => cb());
  return () => {
    unsubLocal();
    unsubEvent();
  };
}
