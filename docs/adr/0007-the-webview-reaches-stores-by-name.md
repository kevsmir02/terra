# 0007. The webview reaches stores by name, never by path

Status: accepted.

## Context

Settings and saved spaces persist through `tauri-plugin-store`. The frontend
used the plugin's `LazyStore`, which calls `plugin:store|load` with a path, and
the capability granted `store:default`, which is every plugin command. `load`
resolves the path with `BaseDirectory::AppData`, and joining an absolute path
onto a base yields the absolute path: script in the webview could open a store
at `~/.bashrc` or `~/.config/autostart/x.desktop`, set a key and save, and the
plugin would write JSON there. ADR 0006 recorded this as residual risk.

The plugin offers no scope to narrow it. Its commands read no command scope,
unlike `tauri-plugin-fs`, so there is no capability entry that says "only these
files". Withholding `allow-load` and `allow-get-store` alone does not work
either: the remaining commands take a resource id, and the only public Rust API
that builds a store returns the store, not the id the JS client needs.

## Decision

No capability grants any `store:` permission. The plugin stays registered for
its Rust API, its debounced autosave and its save on `RunEvent::Exit`, and five
commands in `modules/app_store.rs` (`app_store_entries`, `_get`, `_set`,
`_delete`, `_save`) wrap it. Each takes an `AppStore` enum, `settings` or
`spaces`, which maps to the file name the store already had
(`terra-settings.json`, `terra-spaces.json`) and to its autosave debounce. A
string that is not one of those names fails deserialization before any code
runs. `src/lib/appStore.ts` is the frontend's only client, and
`@tauri-apps/plugin-store` is no longer a dependency.

The file names and the base directory did not change, so existing stores load
as they are; there is nothing to migrate.

Locked by `app_store::tests`: a hostile name (absolute, `..`, a file name, a
different case) does not deserialize, every store file is a single path
component, and no file under `capabilities/` grants a `store:` permission.

## Consequences

- A new persisted store is a new enum variant, not a new path in the frontend.
- The webview still writes the contents of both stores, including the saved
  spaces whose roots boot restores. Closing that would mean validating spaces
  in Rust, which ADR 0006's residual-risk list already covers.
- `store://change` is still emitted by the plugin and `appStore.onChange`
  filters it by file name, so same-window change listeners behave as before.
