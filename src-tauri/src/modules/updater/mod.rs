pub mod package;
pub mod verify;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::{AppHandle, Manager};

use crate::modules::proc::hide_console;
use package::PackageKind;

/// A downloaded package is only ever addressed by bare file name. Anything
/// with a separator, a parent component, or an empty/relative-marker name is
/// refused, so a compromised webview cannot steer the privileged install at an
/// arbitrary file on disk.
fn safe_staged_path(dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains('/')
        || file_name.contains('\\')
    {
        return Err(format!("refusing unsafe update file name: {file_name}"));
    }
    Ok(dir.join(file_name))
}

/// Appends `.sig` to the whole file name. `Path::with_extension` would
/// *replace* the extension, turning `Terra-0.8.6-1.x86_64.rpm` into
/// `Terra-0.8.6-1.x86_64.sig` — which is not the name the release publishes.
fn sig_path(pkg: &Path) -> PathBuf {
    let mut name = pkg.as_os_str().to_os_string();
    name.push(".sig");
    PathBuf::from(name)
}

/// The single staged package: the one `.sig` in the directory, minus `.sig`.
fn staged_package_path(dir: &Path) -> Result<PathBuf, String> {
    let mut found: Option<PathBuf> = None;
    for entry in fs::read_dir(dir).map_err(|e| format!("staging dir unreadable: {e}"))? {
        let path = entry.map_err(|e| format!("staging dir unreadable: {e}"))?.path();
        if path.extension().is_some_and(|e| e == "sig") {
            if found.is_some() {
                return Err("more than one staged update".to_string());
            }
            let s = path.to_string_lossy();
            found = Some(PathBuf::from(
                s.strip_suffix(".sig")
                    .ok_or_else(|| "malformed staged signature".to_string())?
                    .to_string(),
            ));
        }
    }
    found.ok_or_else(|| "no staged update — call updater_stage_begin first".to_string())
}

fn staging_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no app cache dir: {e}"))?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create staging dir: {e}"))?;
    Ok(dir)
}

/// At most one staged package exists at a time, so an abandoned download from
/// an earlier session can never be installed by accident.
fn clear_staging(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// The pubkey the updater plugin already validates against on macOS/Windows.
/// Read from config so there is exactly one source of truth.
fn configured_pubkey(app: &AppHandle) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "no updater pubkey configured".to_string())
}

#[tauri::command]
pub async fn updater_package_kind() -> Result<PackageKind, String> {
    tauri::async_runtime::spawn_blocking(package::detect)
        .await
        .map_err(|e| format!("updater_package_kind join: {e}"))
}

/// Clears staging and records the signature. Must precede
/// `updater_stage_finish`, which carries the package bytes as a raw body and
/// therefore cannot also carry metadata.
#[tauri::command]
pub async fn updater_stage_begin(
    app: AppHandle,
    file_name: String,
    signature: String,
) -> Result<(), String> {
    let dir = staging_dir(&app)?;
    // Validate before writing anything, so a hostile name never reaches disk.
    let path = safe_staged_path(&dir, &file_name)?;

    tauri::async_runtime::spawn_blocking(move || {
        clear_staging(&dir);
        fs::write(sig_path(&path), signature.as_bytes())
            .map_err(|e| format!("could not stage signature: {e}"))
    })
    .await
    .map_err(|e| format!("updater_stage_begin join: {e}"))?
}

/// Receives the package as a raw IPC body, verifies it against the signature
/// recorded by `updater_stage_begin`, and writes it only if it verifies.
#[tauri::command]
pub async fn updater_stage_finish(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        _ => return Err("updater_stage_finish expects a raw binary body".to_string()),
    };
    let dir = staging_dir(&app)?;
    let pubkey = configured_pubkey(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let path = staged_package_path(&dir)?;
        let signature = fs::read_to_string(sig_path(&path))
            .map_err(|e| format!("staged signature missing: {e}"))?;

        // Verify before the bytes ever land on disk, so a failed download
        // leaves nothing behind to install.
        verify::verify(&pubkey, &bytes, &signature)?;
        fs::write(&path, &bytes).map_err(|e| format!("could not stage update: {e}"))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("updater_stage_finish join: {e}"))?
}

#[tauri::command]
pub async fn updater_install(app: AppHandle, file_name: String) -> Result<(), String> {
    let dir = staging_dir(&app)?;
    let path = safe_staged_path(&dir, &file_name)?;
    let pubkey = configured_pubkey(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        // Re-verify immediately before escalating: verifying only at stage
        // time would leave a window in which the file could be swapped.
        let bytes = fs::read(&path).map_err(|e| format!("staged update missing: {e}"))?;
        let signature = fs::read_to_string(sig_path(&path))
            .map_err(|e| format!("staged signature missing: {e}"))?;
        verify::verify(&pubkey, &bytes, &signature)?;

        let kind = package::detect();
        let (bin, args) = package::install_command(kind, &path)
            .ok_or_else(|| "this install format cannot be updated in place".to_string())?;

        let mut cmd = Command::new(bin);
        cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
        hide_console(&mut cmd);
        let out = cmd
            .output()
            .map_err(|e| format!("could not launch the installer: {e}"))?;

        match out.status.code() {
            Some(0) => {
                clear_staging(&dir);
                Ok(())
            }
            // polkit's documented exit codes for dismissal and refusal.
            Some(126) => Err("cancelled".to_string()),
            Some(127) => Err("not authorized".to_string()),
            _ => {
                let err = String::from_utf8_lossy(&out.stderr);
                let tail: String = err.lines().rev().take(5).collect::<Vec<_>>().join("\n");
                Err(format!("install failed: {tail}"))
            }
        }
    })
    .await
    .map_err(|e| format!("updater_install join: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn accepts_a_plain_file_name() {
        let p = safe_staged_path(Path::new("/tmp/stage"), "Terra-0.8.6-1.x86_64.rpm").unwrap();
        assert_eq!(p, Path::new("/tmp/stage/Terra-0.8.6-1.x86_64.rpm"));
    }

    #[test]
    fn rejects_parent_traversal() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "../../etc/passwd").is_err());
    }

    #[test]
    fn rejects_a_bare_parent_component() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "..").is_err());
    }

    #[test]
    fn rejects_forward_slashes() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "sub/pkg.rpm").is_err());
    }

    #[test]
    fn rejects_backslashes() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "sub\\pkg.rpm").is_err());
    }

    #[test]
    fn rejects_an_absolute_path() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "/etc/passwd").is_err());
    }

    #[test]
    fn rejects_an_empty_name() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "").is_err());
    }

    #[test]
    fn rejects_a_dotfile_current_dir() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), ".").is_err());
    }

    #[test]
    fn sig_path_appends_rather_than_replacing_the_extension() {
        // The release publishes Terra-0.8.6-1.x86_64.rpm.sig — NOT
        // Terra-0.8.6-1.x86_64.sig, which is what with_extension would give.
        assert_eq!(
            sig_path(Path::new("/tmp/stage/Terra-0.8.6-1.x86_64.rpm")),
            Path::new("/tmp/stage/Terra-0.8.6-1.x86_64.rpm.sig")
        );
    }

    #[test]
    fn staged_package_path_recovers_the_name_from_the_signature() {
        let dir = std::env::temp_dir().join(format!("terra-stage-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Terra-0.8.6-1.x86_64.rpm.sig"), b"sig").unwrap();

        assert_eq!(
            staged_package_path(&dir).unwrap(),
            dir.join("Terra-0.8.6-1.x86_64.rpm")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn staged_package_path_errors_when_nothing_is_staged() {
        let dir = std::env::temp_dir().join(format!("terra-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(staged_package_path(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
