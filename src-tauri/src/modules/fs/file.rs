use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use std::{fs, io::Write};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tempfile::NamedTempFile;

use super::{authorized_entry, authorized_new, authorized_read};
use crate::modules::blocking::{on_app, on_registry as blocking};
use crate::modules::workspace::WorkspaceRegistry;

pub(super) const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
/// Ceiling for explicit "open anyway"; mirrored as FORCE_READ_LIMIT in useDocument.ts.
const FORCE_MAX_READ_BYTES: u64 = 50 * 1024 * 1024;
pub(super) const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
        mtime: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

pub(super) fn mtime_millis(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn fs_read_file(
    path: String,
    force: Option<bool>,
    app: AppHandle,
) -> Result<ReadResult, String> {
    blocking(app, move |r| read_file(r, &path, force.unwrap_or(false))).await
}

pub fn read_file(
    registry: &WorkspaceRegistry,
    path: &str,
    force: bool,
) -> Result<ReadResult, String> {
    let p = authorized_read(registry, path)?;
    read_file_sync(&p, force)
}

fn read_file_sync(p: &Path, force: bool) -> Result<ReadResult, String> {
    let meta = std::fs::metadata(p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    let limit = if force {
        FORCE_MAX_READ_BYTES
    } else {
        MAX_READ_BYTES
    };
    if size > limit {
        return Ok(ReadResult::TooLarge { size, limit });
    }

    let bytes = std::fs::read(p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text {
            content,
            size,
            mtime: mtime_millis(&meta),
        }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

#[derive(Serialize, Clone)]
pub(super) struct FileWrittenEvent {
    pub(super) path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) source: Option<String>,
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks. An existing
/// target's mode goes onto the temp file before the rename, so the file is
/// never visible with the temp file's 0600.
pub(super) fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    if let Ok(meta) = fs::metadata(target) {
        tmp.as_file().set_permissions(meta.permissions())?;
    }
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

/// Returns the new mtime so the editor can track disk state for conflict
/// detection without a follow-up stat.
#[tauri::command]
pub async fn fs_write_file(
    path: String,
    content: String,
    source: Option<String>,
    app: AppHandle,
) -> Result<u64, String> {
    let written = path.clone();
    let mtime = blocking(app.clone(), move |r| write_file(r, &written, content.as_bytes())).await?;
    let _ = app.emit("fs:file-written", FileWrittenEvent { path, source });
    Ok(mtime)
}

pub fn write_file(
    registry: &WorkspaceRegistry,
    path: &str,
    content: &[u8],
) -> Result<u64, String> {
    // `authorized_new` covers both cases a save hits: an existing file, and a
    // first save into an already-authorized directory.
    let target = authorized_new(registry, path)?;
    write_atomic(&target, content).map_err(|e| {
        log::warn!("fs_write_file({}) failed: {e}", target.display());
        e.to_string()
    })?;
    Ok(fs::metadata(&target).map(|m| mtime_millis(&m)).unwrap_or(0))
}

/// Grants `asset://` access to one already-authorized file, for the media and
/// PDF previews. The static scope is empty on purpose: a blanket `**` would let
/// the webview read any file on disk over a channel the workspace gate never
/// sees. Granting per file keeps the protocol as narrow as what the user opened.
#[tauri::command]
pub async fn fs_allow_asset(path: String, app: AppHandle) -> Result<String, String> {
    on_app(app, move |app| {
        let canonical = asset_file(&app.state::<WorkspaceRegistry>(), &path)?;
        app.asset_protocol_scope()
            .allow_file(&canonical)
            .map_err(|e| e.to_string())?;
        Ok(super::to_canon(&canonical))
    })
    .await
}

pub fn asset_file(registry: &WorkspaceRegistry, path: &str) -> Result<PathBuf, String> {
    let canonical = authorized_read(registry, path)?;
    if !canonical.is_file() {
        return Err(format!("not a file: {}", canonical.display()));
    }
    Ok(canonical)
}

#[tauri::command]
pub async fn fs_canonicalize(path: String, app: AppHandle) -> Result<String, String> {
    blocking(app, move |r| authorized_read(r, &path).map(super::to_canon)).await
}

#[tauri::command]
pub async fn fs_stat(path: String, app: AppHandle) -> Result<FileStat, String> {
    blocking(app, move |r| stat(r, &path)).await
}

pub fn stat(registry: &WorkspaceRegistry, path: &str) -> Result<FileStat, String> {
    // Not `authorized_read`: reporting `Symlink` requires the entry itself.
    let p = authorized_entry(registry, path)?;
    let own = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
    if !own.file_type().is_symlink() {
        return Ok(file_stat(&own, if own.is_dir() { StatKind::Dir } else { StatKind::File }));
    }
    // A link's target is described only when the target is itself authorized;
    // otherwise its size and mtime would leak from outside every root.
    let target = fs::canonicalize(&p).map_err(|e| e.to_string())?;
    let meta = if registry.is_authorized(&target) {
        fs::metadata(target).map_err(|e| e.to_string())?
    } else {
        own
    };
    Ok(file_stat(&meta, StatKind::Symlink))
}

fn file_stat(meta: &fs::Metadata, kind: StatKind) -> FileStat {
    FileStat {
        size: meta.len(),
        mtime: mtime_millis(meta),
        kind,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text {
                content,
                size,
                mtime,
            } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
                assert!(mtime > 0);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 with no null byte: must still classify as binary.
        std::fs::write(&f, [0xff, 0xfe, 0xfd, 0xfc]).unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn force_lifts_the_default_size_limit() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("big.txt");
        std::fs::write(&f, vec![b'a'; (MAX_READ_BYTES + 1) as usize]).unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::TooLarge { .. }
        ));
        assert!(matches!(
            read_file_sync(&f, true).unwrap(),
            ReadResult::Text { .. }
        ));
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn overwrite_keeps_the_target_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("run.sh");
        std::fs::write(&target, b"old").unwrap();
        std::fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        write_atomic(&target, b"new").unwrap();
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o755);
    }

    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.terra.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }

    fn gated() -> (tempfile::TempDir, tempfile::TempDir, WorkspaceRegistry) {
        let inside = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(inside.path()).unwrap();
        (inside, outside, registry)
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn every_file_core_refuses_a_path_outside_all_roots() {
        let (_inside, outside, reg) = gated();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, b"secret").unwrap();
        let p = s(&secret);
        let refused = |e: String| assert!(e.contains("outside the authorized workspace"), "got: {e}");

        refused(read_file(&reg, &p, true).err().expect("read refused"));
        refused(write_file(&reg, &p, b"x").unwrap_err());
        refused(asset_file(&reg, &p).unwrap_err());
        refused(stat(&reg, &p).err().expect("stat refused"));
        assert_eq!(std::fs::read(&secret).unwrap(), b"secret");
    }

    #[test]
    fn write_through_a_link_that_points_outside_is_refused() {
        let (inside, outside, reg) = gated();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, b"secret").unwrap();
        let link = inside.path().join("note.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        assert!(write_file(&reg, &s(&link), b"pwned").is_err());
        assert!(read_file(&reg, &s(&link), false).is_err());
        assert!(asset_file(&reg, &s(&link)).is_err());
        assert_eq!(std::fs::read(&secret).unwrap(), b"secret");
    }

    #[test]
    fn asset_grant_is_for_files_only() {
        let (inside, _outside, reg) = gated();
        let err = asset_file(&reg, &s(inside.path())).unwrap_err();
        assert!(err.contains("not a file"), "got: {err}");
    }

    // Stat acts on the entry, but only describes a link's target when that
    // target is itself inside a root.
    #[test]
    fn stat_of_a_link_to_outside_does_not_describe_the_target() {
        let (inside, outside, reg) = gated();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, vec![b'x'; 4096]).unwrap();
        let link = inside.path().join("leak");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let st = stat(&reg, &s(&link)).expect("the link itself is inside");
        assert!(matches!(st.kind, StatKind::Symlink));
        assert_ne!(st.size, 4096);
    }
}
