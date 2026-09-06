use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::modules::sync::MutexExt;

// Short TTL keeps the auth-check TOCTOU window tight while still coalescing the
// burst of canonicalize calls within a single panel refresh (~100ms).
const CANONICAL_TTL: Duration = Duration::from_secs(1);
const CANONICAL_CACHE_CAP: usize = 256;

struct CanonicalEntry {
    canonical: PathBuf,
    inserted_at: Instant,
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    roots: Mutex<HashSet<PathBuf>>,
    canonical_cache: Mutex<HashMap<PathBuf, CanonicalEntry>>,
}

impl WorkspaceRegistry {
    pub fn authorize<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let canonical = std::fs::canonicalize(path.as_ref())?;
        let mut set = self.roots.lock_or_recover();
        // Every fs, git, PTY and LSP gate scans this set linearly, and OSC 7
        // re-authorizes on each `cd`, so walking a tree in the terminal would
        // grow it without bound while granting nothing new. A path already
        // covered is a no-op; a path that covers existing roots replaces them.
        // Coverage is identical either way, which is what keeps this safe.
        if !set.iter().any(|root| canonical.starts_with(root)) {
            set.retain(|root| !root.starts_with(&canonical));
            set.insert(canonical.clone());
        }
        Ok(canonical)
    }

    pub fn is_authorized(&self, target: &Path) -> bool {
        let set = self.roots.lock_or_recover();
        set.iter().any(|root| target.starts_with(root))
    }

    pub fn canonicalize_cached<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let key = path.as_ref().to_path_buf();
        {
            let cache = self
                .canonical_cache
                .lock()
                .expect("canonical cache poisoned");
            if let Some(entry) = cache.get(&key) {
                if entry.inserted_at.elapsed() < CANONICAL_TTL {
                    return Ok(entry.canonical.clone());
                }
            }
        }
        let canonical = std::fs::canonicalize(&key)?;
        let mut cache = self
            .canonical_cache
            .lock()
            .expect("canonical cache poisoned");
        if cache.len() >= CANONICAL_CACHE_CAP {
            cache.retain(|_, entry| entry.inserted_at.elapsed() < CANONICAL_TTL);
            if cache.len() >= CANONICAL_CACHE_CAP {
                cache.clear();
            }
        }
        cache.insert(
            key,
            CanonicalEntry {
                canonical: canonical.clone(),
                inserted_at: Instant::now(),
            },
        );
        Ok(canonical)
    }
}

// `None` means "use bootstrapped default". `Some` is canonicalized to defeat
// symlink/`..` traversal and must sit under an authorized root.
pub fn authorize_spawn_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = PathBuf::from(cwd);
    let canonical =
        std::fs::canonicalize(&resolved).map_err(|e| format!("cwd not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("cwd is not a directory: {}", canonical.display()));
    }
    if !registry.is_authorized(&canonical) {
        return Err(format!(
            "cwd is outside the authorized workspace: {}",
            canonical.display()
        ));
    }
    Ok(Some(canonical))
}

// User-initiated terminal spawn: canonicalize, require a real dir, and register
// it as a root instead of rejecting paths outside existing roots.
pub fn authorize_user_spawn_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = PathBuf::from(cwd);
    let canonical =
        std::fs::canonicalize(&resolved).map_err(|e| format!("cwd not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("cwd is not a directory: {}", canonical.display()));
    }
    registry.authorize(&canonical).map_err(|e| e.to_string())?;
    Ok(Some(canonical))
}

// A saved cwd can be stale; the terminal must still open, so fall back to home.
pub fn user_spawn_cwd_or_home(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
) -> Option<String> {
    let cwd = cwd.map(str::trim).filter(|s| !s.is_empty())?;
    match authorize_user_spawn_cwd(registry, Some(cwd)) {
        Ok(_) => Some(cwd.to_owned()),
        Err(e) => {
            log::warn!("pty cwd {cwd:?} unusable ({e}); opening home");
            None
        }
    }
}

pub fn bootstrap_registry(registry: &WorkspaceRegistry) {
    let _ = registry.authorize(resolve_launch_dir());
    if let Some(home) = dirs::home_dir() {
        let _ = registry.authorize(home);
    }
}

#[tauri::command]
pub async fn workspace_authorize(
    path: String,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<String, String> {
    let resolved = PathBuf::from(&path);
    let canonical = registry.authorize(&resolved).map_err(|e| e.to_string())?;
    Ok(crate::modules::fs::to_canon(&canonical))
}

#[tauri::command]
pub async fn workspace_current_dir(
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<String, String> {
    let launch = resolve_launch_dir();
    let canonical = registry.authorize(&launch).map_err(|e| e.to_string())?;
    Ok(crate::modules::fs::to_canon(&canonical))
}

// Snapshotted once at app startup so the live `current_dir()` drifting later
// (file dialogs, plugin chdir) can't shift the value seen by IPC or spawn.
static LAUNCH_CWD: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn init_launch_cwd(cli_dir: Option<&str>) {
    LAUNCH_CWD.get_or_init(|| resolve_launch_cwd(cli_dir, std::env::current_dir().ok()));
}

fn resolve_launch_cwd(cli_dir: Option<&str>, env_cwd: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(dir) = cli_dir {
        let p = PathBuf::from(dir);
        if p.is_dir() {
            return Some(p);
        }
    }
    env_cwd.filter(|p| is_usable_launch_dir(p))
}

pub fn launch_cwd_snapshot() -> Option<PathBuf> {
    LAUNCH_CWD.get().and_then(|o| o.clone())
}

fn resolve_launch_dir() -> PathBuf {
    if let Some(cwd) = launch_cwd_snapshot() {
        return cwd;
    }
    if let Some(cwd) = std::env::current_dir()
        .ok()
        .filter(|p| is_usable_launch_dir(p))
    {
        return cwd;
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn is_usable_launch_dir(path: &Path) -> bool {
    if !path.is_dir() || path == Path::new("/") {
        return false;
    }
    if is_executable_dir(path) {
        return false;
    }
    let s = path.to_string_lossy();
    if s.contains(".app/Contents/") {
        return false;
    }
    // The AppImage mount (/tmp/.mount_*) is not a real working directory.
    if std::env::var_os("APPDIR").is_some_and(|appdir| path.starts_with(&appdir)) {
        return false;
    }
    if cfg!(debug_assertions) && path.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
        return false;
    }
    true
}

fn is_executable_dir(path: &Path) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Some(exe_dir) = exe.parent() else {
        return false;
    };
    match (std::fs::canonicalize(path), std::fs::canonicalize(exe_dir)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

const APPIMAGE_PATH_VARS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "PATH",
    "XDG_DATA_DIRS",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GST_PLUGIN_PATH",
    "GI_TYPELIB_PATH",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
];

const APPIMAGE_VALUE_VARS: &[&str] = &[
    "GDK_PIXBUF_MODULE_FILE",
    "LD_PRELOAD",
    "FONTCONFIG_FILE",
    "FONTCONFIG_PATH",
];

const APPIMAGE_MARKER_VARS: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0"];

pub fn appimage_env_overrides() -> Vec<(&'static str, Option<OsString>)> {
    let Some(appdir) = std::env::var_os("APPDIR") else {
        return Vec::new();
    };
    compute_appimage_env_overrides(Path::new(&appdir), |k| std::env::var_os(k))
}

fn compute_appimage_env_overrides(
    appdir: &Path,
    read: impl Fn(&str) -> Option<OsString>,
) -> Vec<(&'static str, Option<OsString>)> {
    let mut out = Vec::new();

    for &key in APPIMAGE_PATH_VARS {
        let Some(val) = read(key) else { continue };
        let original: Vec<PathBuf> = std::env::split_paths(&val).collect();
        let kept: Vec<PathBuf> = original
            .iter()
            .filter(|p| !p.as_os_str().is_empty() && !p.starts_with(appdir))
            .cloned()
            .collect();
        if kept.len() == original.len() {
            continue; // nothing AppImage-injected; leave as-is
        }
        match std::env::join_paths(&kept) {
            Ok(joined) if !kept.is_empty() => out.push((key, Some(joined))),
            _ => out.push((key, None)),
        }
    }

    for &key in APPIMAGE_VALUE_VARS {
        if read(key).is_some_and(|v| Path::new(&v).starts_with(appdir)) {
            out.push((key, None));
        }
    }

    for &key in APPIMAGE_MARKER_VARS {
        if read(key).is_some() {
            out.push((key, None));
        }
    }

    out
}

#[cfg(test)]
mod auth_tests {
    use super::*;
    use std::env;
    use std::fs;

    #[test]
    fn authorizing_a_child_of_a_root_does_not_grow_the_set() {
        let dir = tempdir("registry-child");
        let nested = dir.join("a").join("b");
        fs::create_dir_all(&nested).unwrap();
        let reg = WorkspaceRegistry::default();
        reg.authorize(&dir).unwrap();
        reg.authorize(dir.join("a")).unwrap();
        reg.authorize(&nested).unwrap();
        assert_eq!(reg.roots.lock_or_recover().len(), 1);
        assert!(reg.is_authorized(&nested));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn authorizing_a_parent_supersedes_the_children_it_covers() {
        let dir = tempdir("registry-parent");
        let a = dir.join("a");
        let b = dir.join("b");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let reg = WorkspaceRegistry::default();
        reg.authorize(&a).unwrap();
        reg.authorize(&b).unwrap();
        assert_eq!(reg.roots.lock_or_recover().len(), 2);
        reg.authorize(&dir).unwrap();
        assert_eq!(reg.roots.lock_or_recover().len(), 1);
        assert!(reg.is_authorized(&a));
        assert!(reg.is_authorized(&b));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_sibling_root_is_still_refused_after_collapsing() {
        let dir = tempdir("registry-sibling");
        let inside = dir.join("inside");
        let outside = dir.join("outside");
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let reg = WorkspaceRegistry::default();
        reg.authorize(&inside).unwrap();
        reg.authorize(inside.join(".")).unwrap();
        assert!(!reg.is_authorized(&outside));
        fs::remove_dir_all(&dir).ok();
    }

    fn tempdir(label: &str) -> PathBuf {
        let mut p = env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        p.push(format!("terra-auth-{label}-{nanos}-{}", std::process::id()));
        fs::create_dir_all(&p).expect("create tempdir");
        fs::canonicalize(&p).expect("canonicalize tempdir")
    }

    #[test]
    fn authorize_spawn_cwd_accepts_none() {
        let reg = WorkspaceRegistry::default();
        assert!(authorize_spawn_cwd(&reg, None)
            .unwrap()
            .is_none());
    }

    #[test]
    fn authorize_spawn_cwd_accepts_empty_string() {
        let reg = WorkspaceRegistry::default();
        assert!(authorize_spawn_cwd(&reg, Some("   "))
            .unwrap()
            .is_none());
    }

    #[test]
    fn authorize_spawn_cwd_accepts_authorized_path() {
        let dir = tempdir("ok");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&dir).expect("authorize root");
        let s = dir.to_string_lossy().into_owned();
        let resolved = authorize_spawn_cwd(&reg, Some(&s))
            .expect("authorized")
            .expect("returned canonical");
        assert_eq!(resolved, dir);
    }

    #[test]
    fn authorize_spawn_cwd_accepts_subdir_of_authorized_root() {
        let root = tempdir("subroot");
        let sub = root.join("inside");
        fs::create_dir_all(&sub).expect("subdir");
        let canonical_sub = fs::canonicalize(&sub).expect("canon sub");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&root).expect("authorize root");
        let s = canonical_sub.to_string_lossy().into_owned();
        let resolved = authorize_spawn_cwd(&reg, Some(&s))
            .expect("subdir authorized")
            .expect("returned canonical");
        assert_eq!(resolved, canonical_sub);
    }

    #[test]
    fn authorize_spawn_cwd_rejects_unauthorized_path() {
        let allowed = tempdir("allowed");
        let foreign = tempdir("foreign");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).expect("authorize root");
        let s = foreign.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s))
            .expect_err("should reject unauthorized cwd");
        assert!(err.contains("outside"), "got: {err}");
    }

    #[test]
    fn authorize_spawn_cwd_rejects_missing_path() {
        let mut missing = env::temp_dir();
        missing.push(format!(
            "terra-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let reg = WorkspaceRegistry::default();
        let s = missing.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s))
            .expect_err("should reject missing path");
        assert!(err.contains("cwd not accessible"), "got: {err}");
    }

    #[test]
    fn authorize_user_spawn_cwd_registers_unauthorized_path() {
        let dir = tempdir("userspawn");
        let reg = WorkspaceRegistry::default();
        let s = dir.to_string_lossy().into_owned();
        assert!(!reg.is_authorized(&dir));
        let resolved = authorize_user_spawn_cwd(&reg, Some(&s))
            .expect("user spawn allowed anywhere")
            .expect("returned canonical");
        assert_eq!(resolved, dir);
        assert!(reg.is_authorized(&dir));
    }

    #[test]
    fn authorize_user_spawn_cwd_rejects_missing_path() {
        let mut missing = env::temp_dir();
        missing.push(format!("terra-user-missing-{}", std::process::id()));
        let reg = WorkspaceRegistry::default();
        let s = missing.to_string_lossy().into_owned();
        let err = authorize_user_spawn_cwd(&reg, Some(&s))
            .expect_err("missing path must fail");
        assert!(err.contains("cwd not accessible"), "got: {err}");
    }

    #[test]
    fn user_spawn_cwd_or_home_keeps_accessible_dir() {
        let dir = tempdir("orhome-ok");
        let reg = WorkspaceRegistry::default();
        let s = dir.to_string_lossy().into_owned();
        assert_eq!(
            user_spawn_cwd_or_home(&reg, Some(&s)),
            Some(s)
        );
        assert!(reg.is_authorized(&dir));
    }

    #[test]
    fn user_spawn_cwd_or_home_falls_back_when_inaccessible() {
        let mut missing = env::temp_dir();
        missing.push(format!("terra-orhome-missing-{}", std::process::id()));
        let reg = WorkspaceRegistry::default();
        let s = missing.to_string_lossy().into_owned();
        assert_eq!(
            user_spawn_cwd_or_home(&reg, Some(&s)),
            None
        );
    }

    #[test]
    fn user_spawn_cwd_or_home_passes_through_empty() {
        let reg = WorkspaceRegistry::default();
        assert_eq!(
            user_spawn_cwd_or_home(&reg, None),
            None
        );
        assert_eq!(
            user_spawn_cwd_or_home(&reg, Some("  ")),
            None
        );
    }

    #[test]
    fn authorize_spawn_cwd_blocks_symlink_escape() {
        let allowed = tempdir("symroot");
        let outside = tempdir("symtarget");
        let link = allowed.join("escape");
        std::os::unix::fs::symlink(&outside, &link).expect("symlink");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).expect("authorize root");
        let s = link.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s))
            .expect_err("symlink-escape must be rejected");
        assert!(err.contains("outside"), "got: {err}");
    }

    #[test]
    fn resolve_launch_cwd_prefers_cli_dir_over_env() {
        let cli = tempdir("cli");
        let env = tempdir("env");
        let s = cli.to_string_lossy().into_owned();
        let resolved = resolve_launch_cwd(Some(&s), Some(env.clone()));
        assert_eq!(resolved.as_deref(), Some(cli.as_path()));
    }

    #[test]
    fn resolve_launch_cwd_falls_back_to_env_when_cli_missing() {
        let env = tempdir("envonly");
        assert_eq!(resolve_launch_cwd(None, Some(env.clone())), Some(env));
    }

    #[test]
    fn resolve_launch_cwd_ignores_nonexistent_cli_dir() {
        let env = tempdir("envfb");
        let resolved = resolve_launch_cwd(Some("/no/such/terra/dir"), Some(env.clone()));
        assert_eq!(resolved, Some(env));
    }
}

#[cfg(test)]
mod appimage_tests {
    use super::*;
    use std::collections::HashMap;

    fn reader(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), OsString::from(v)))
            .collect();
        move |k: &str| map.get(k).cloned()
    }

    fn find<'a>(
        out: &'a [(&'static str, Option<OsString>)],
        key: &str,
    ) -> Option<&'a Option<OsString>> {
        out.iter().find(|(k, _)| *k == key).map(|(_, v)| v)
    }

    #[test]
    fn strips_appdir_from_path_lists_and_unsets_when_empty() {
        let appdir = Path::new("/tmp/.mount_Terra_X");
        let env = reader(&[
            ("LD_LIBRARY_PATH", "/tmp/.mount_Terra_X/usr/lib:/usr/lib"),
            ("PATH", "/tmp/.mount_Terra_X/usr/bin:/usr/bin:/bin"),
            ("GST_PLUGIN_SYSTEM_PATH", "/tmp/.mount_Terra_X/usr/lib/gstreamer-1.0"),
            ("APPDIR", "/tmp/.mount_Terra_X"),
        ]);
        let out = compute_appimage_env_overrides(appdir, env);

        assert_eq!(find(&out, "LD_LIBRARY_PATH"), Some(&Some(OsString::from("/usr/lib"))));
        assert_eq!(find(&out, "PATH"), Some(&Some(OsString::from("/usr/bin:/bin"))));
        // Only an APPDIR entry, so the var is removed entirely.
        assert_eq!(find(&out, "GST_PLUGIN_SYSTEM_PATH"), Some(&None));
        assert_eq!(find(&out, "APPDIR"), Some(&None));
    }

    #[test]
    fn leaves_untouched_vars_alone() {
        let appdir = Path::new("/tmp/.mount_Terra_X");
        let env = reader(&[
            ("LD_LIBRARY_PATH", "/usr/lib:/usr/local/lib"),
            ("LD_PRELOAD", "/home/u/my.so"),
        ]);
        let out = compute_appimage_env_overrides(appdir, env);

        // No APPDIR component => no override emitted for these.
        assert!(find(&out, "LD_LIBRARY_PATH").is_none());
        assert!(find(&out, "LD_PRELOAD").is_none());
    }

    #[test]
    fn unsets_value_vars_only_when_pointing_into_appdir() {
        let appdir = Path::new("/tmp/.mount_Terra_X");
        let into = reader(&[("LD_PRELOAD", "/tmp/.mount_Terra_X/usr/lib/x.so")]);
        assert_eq!(find(&compute_appimage_env_overrides(appdir, into), "LD_PRELOAD"), Some(&None));

        let outside = reader(&[("FONTCONFIG_FILE", "/etc/fonts/fonts.conf")]);
        assert!(find(&compute_appimage_env_overrides(appdir, outside), "FONTCONFIG_FILE").is_none());
    }
}
