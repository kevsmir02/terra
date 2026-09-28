use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Wry};
use tauri_plugin_store::{Store, StoreExt};

use crate::modules::blocking::on_app;

/// The only stores the webview can reach, named rather than pathed. The store
/// plugin's own `load` joins any path onto the app data dir and accepts an
/// absolute one, so granting it would let script write JSON anywhere the user
/// can (ADR 0011). Its commands are withheld from every capability and these
/// wrap the Rust API instead.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AppStore {
    Settings,
    Spaces,
}

impl AppStore {
    #[cfg(test)]
    const ALL: [AppStore; 2] = [AppStore::Settings, AppStore::Spaces];

    /// Resolved by the plugin against the app data dir; the names predate the
    /// wrapper, so existing files load unchanged.
    pub fn file_name(self) -> &'static str {
        match self {
            AppStore::Settings => "terra-settings.json",
            AppStore::Spaces => "terra-spaces.json",
        }
    }

    fn auto_save(self) -> Duration {
        match self {
            AppStore::Settings => Duration::from_millis(200),
            AppStore::Spaces => Duration::from_millis(500),
        }
    }
}

fn open(app: &AppHandle, which: AppStore) -> Result<Arc<Store<Wry>>, String> {
    app.store_builder(which.file_name())
        .auto_save(which.auto_save())
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn app_store_entries(
    store: AppStore,
    app: AppHandle,
) -> Result<Vec<(String, Value)>, String> {
    on_app(app, move |app| Ok(open(app, store)?.entries())).await
}

#[tauri::command]
pub async fn app_store_get(
    store: AppStore,
    key: String,
    app: AppHandle,
) -> Result<Option<Value>, String> {
    on_app(app, move |app| Ok(open(app, store)?.get(&key))).await
}

#[tauri::command]
pub async fn app_store_set(
    store: AppStore,
    key: String,
    value: Value,
    app: AppHandle,
) -> Result<(), String> {
    on_app(app, move |app| {
        open(app, store)?.set(key, value);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn app_store_delete(
    store: AppStore,
    key: String,
    app: AppHandle,
) -> Result<bool, String> {
    on_app(app, move |app| Ok(open(app, store)?.delete(&key))).await
}

#[tauri::command]
pub async fn app_store_save(store: AppStore, app: AppHandle) -> Result<(), String> {
    on_app(app, move |app| open(app, store)?.save().map_err(|e| e.to_string())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Component, Path};

    fn parse(raw: &str) -> Result<AppStore, serde_json::Error> {
        serde_json::from_value(Value::String(raw.to_string()))
    }

    #[test]
    fn only_the_named_stores_deserialize() {
        assert_eq!(parse("settings").unwrap(), AppStore::Settings);
        assert_eq!(parse("spaces").unwrap(), AppStore::Spaces);
        for hostile in [
            "/home/user/.bashrc",
            "../../.config/autostart/x.desktop",
            "terra-settings.json",
            "Settings",
            "settings/../../x",
            "",
        ] {
            assert!(parse(hostile).is_err(), "{hostile:?} must not name a store");
        }
    }

    #[test]
    fn every_store_file_is_a_bare_name_inside_the_app_data_dir() {
        for which in AppStore::ALL {
            let components: Vec<_> = Path::new(which.file_name()).components().collect();
            assert!(
                matches!(components.as_slice(), [Component::Normal(_)]),
                "{which:?} must resolve to a single file name"
            );
        }
    }

    /// The plugin's commands take a path, so no capability may grant any of
    /// them: the named commands above are the webview's only way in.
    #[test]
    fn no_capability_grants_the_store_plugin() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut scanned = 0;
        for entry in std::fs::read_dir(&dir).expect("capabilities dir") {
            let path = entry.expect("entry").path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            scanned += 1;
            let text = std::fs::read_to_string(&path).expect("read capability");
            let json: Value = serde_json::from_str(&text).expect("capability is JSON");
            let permissions = json["permissions"].as_array().cloned().unwrap_or_default();
            for permission in permissions {
                let id = permission
                    .as_str()
                    .or_else(|| permission["identifier"].as_str())
                    .unwrap_or_default();
                assert!(
                    !id.starts_with("store:"),
                    "{} grants {id}; use the app_store_* commands",
                    path.display()
                );
            }
        }
        assert!(scanned > 0, "found no capability files");
    }
}
