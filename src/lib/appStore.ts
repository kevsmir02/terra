import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** The stores the backend exposes, by name. The webview never names a path:
 * the store plugin's own commands are withheld (ADR 0007). */
export type AppStoreName = "settings" | "spaces";

const FILE_NAME: Record<AppStoreName, string> = {
  settings: "terra-settings.json",
  spaces: "terra-spaces.json",
};

type ChangePayload = { path: string; key: string; value: unknown };

export type AppStore = {
  entries: () => Promise<[string, unknown][]>;
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  save: () => Promise<void>;
  onChange: <T>(
    cb: (key: string, value: T | undefined) => void,
  ) => Promise<UnlistenFn>;
};

export function isChangeFor(store: AppStoreName, path: string): boolean {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file === FILE_NAME[store];
}

export function appStore(store: AppStoreName): AppStore {
  return {
    entries: () => invoke<[string, unknown][]>("app_store_entries", { store }),
    get: async <T>(key: string) =>
      (await invoke<T | null>("app_store_get", { store, key })) ?? undefined,
    set: (key, value) => invoke<void>("app_store_set", { store, key, value }),
    delete: (key) => invoke<boolean>("app_store_delete", { store, key }),
    save: () => invoke<void>("app_store_save", { store }),
    onChange: <T>(cb: (key: string, value: T | undefined) => void) =>
      listen<ChangePayload>("store://change", (e) => {
        if (isChangeFor(store, e.payload.path)) {
          cb(e.payload.key, e.payload.value as T | undefined);
        }
      }),
  };
}
