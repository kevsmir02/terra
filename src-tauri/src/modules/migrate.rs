//! One-shot migration off the pre-rename bundle identifier.
//!
//! Through 0.8.5 the app identified as `app.crynta.terax`. Every directory
//! Tauri resolves — settings/spaces/theme stores, window state, and the
//! webview's localStorage + IndexedDB — is keyed by that identifier, so the
//! rename to `app.crynta.terra` would otherwise present as a factory reset.
//!
//! Paths are computed from `dirs` rather than an `AppHandle` so this can run
//! before the builder exists: the store and webview open their trees during
//! plugin init, which is too late to move anything underneath them.

use std::fs;
use std::path::{Path, PathBuf};

const LEGACY_IDENTIFIER: &str = "app.crynta.terax";
const IDENTIFIER: &str = "app.crynta.terra";

/// Moves every legacy app directory to its renamed counterpart. A destination
/// that already exists is left alone, which makes this idempotent and keeps a
/// fresh install from inheriting a stale tree.
pub fn migrate_legacy_app_dirs() {
    for (legacy, current) in legacy_pairs() {
        if let Err(e) = move_tree(&legacy, &current) {
            // A failed migration means default settings, not a broken launch.
            eprintln!(
                "[terra] could not migrate {} -> {}: {e}",
                legacy.display(),
                current.display()
            );
        }
    }
}

/// The identifier-scoped roots Tauri hands out, paired old -> new.
fn legacy_pairs() -> Vec<(PathBuf, PathBuf)> {
    // Only the macOS arm below pushes, so `mut` is dead weight elsewhere.
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut roots = vec![
        dirs::config_dir(),
        dirs::data_dir(),
        dirs::data_local_dir(),
        dirs::cache_dir(),
    ];
    // WKWebView keeps localStorage outside the Tauri-resolved roots.
    #[cfg(target_os = "macos")]
    roots.push(dirs::home_dir().map(|h| h.join("Library").join("WebKit")));

    let mut pairs = Vec::new();
    for root in roots.into_iter().flatten() {
        let legacy = root.join(LEGACY_IDENTIFIER);
        let current = root.join(IDENTIFIER);
        // config_dir and data_dir are the same path on macOS; don't queue it twice.
        if !pairs.contains(&(legacy.clone(), current.clone())) {
            pairs.push((legacy, current));
        }
    }
    pairs
}

fn move_tree(legacy: &Path, current: &Path) -> Result<(), String> {
    if !legacy.is_dir() || current.exists() {
        return Ok(());
    }
    if let Some(parent) = current.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Same-filesystem rename is the common case; a copy covers the rest
    // (XDG dirs split across mounts, or a bind-mounted config dir).
    match fs::rename(legacy, current) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_dir_all(legacy, current).map_err(|e| e.to_string())?;
            let _ = fs::remove_dir_all(legacy);
            Ok(())
        }
    }
}

fn copy_dir_all(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "terra-migrate-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moves_legacy_tree_when_destination_is_absent() {
        let root = tmp("moves");
        let legacy = root.join(LEGACY_IDENTIFIER);
        fs::create_dir_all(legacy.join("nested")).unwrap();
        fs::write(legacy.join("nested").join("settings.json"), b"{\"a\":1}").unwrap();

        let current = root.join(IDENTIFIER);
        move_tree(&legacy, &current).unwrap();

        assert!(!legacy.exists());
        assert_eq!(
            fs::read(current.join("nested").join("settings.json")).unwrap(),
            b"{\"a\":1}"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn existing_destination_wins_over_legacy() {
        let root = tmp("existing");
        let legacy = root.join(LEGACY_IDENTIFIER);
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("settings.json"), b"old").unwrap();
        let current = root.join(IDENTIFIER);
        fs::create_dir_all(&current).unwrap();
        fs::write(current.join("settings.json"), b"new").unwrap();

        move_tree(&legacy, &current).unwrap();

        assert_eq!(fs::read(current.join("settings.json")).unwrap(), b"new");
        assert!(legacy.exists(), "legacy tree stays put for manual recovery");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_legacy_tree_is_not_an_error() {
        let root = tmp("missing");
        let current = root.join(IDENTIFIER);
        move_tree(&root.join(LEGACY_IDENTIFIER), &current).unwrap();
        assert!(!current.exists(), "fresh installs stay fresh");
        let _ = fs::remove_dir_all(&root);
    }
}
