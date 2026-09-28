use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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

// Saved spaces restore at most this many roots; a real session has a handful.
const MAX_RESTORED_ROOTS: usize = 256;

#[derive(Default)]
pub struct WorkspaceRegistry {
    roots: Mutex<HashSet<PathBuf>>,
    canonical_cache: Mutex<HashMap<PathBuf, CanonicalEntry>>,
    restore_spent: AtomicBool,
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
            let cache = self.canonical_cache.lock_or_recover();
            if let Some(entry) = cache.get(&key) {
                if entry.inserted_at.elapsed() < CANONICAL_TTL {
                    return Ok(entry.canonical.clone());
                }
            }
        }
        let canonical = std::fs::canonicalize(&key)?;
        let mut cache = self.canonical_cache.lock_or_recover();
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

// A spawn never grants: the cwd comes from the webview, so one outside every
// root (stale, or invented) opens the terminal in home instead.
pub fn user_spawn_cwd_or_home(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
) -> Option<String> {
    let cwd = cwd.map(str::trim).filter(|s| !s.is_empty())?;
    match authorize_spawn_cwd(registry, Some(cwd)) {
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

fn existing_dir(path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    if !Path::new(path).is_absolute() {
        return Err(format!("not an absolute path: {path:?}"));
    }
    let canonical = std::fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("not a directory: {}", canonical.display()));
    }
    Ok(canonical)
}

#[derive(Debug, PartialEq, Eq)]
pub enum RootGrant {
    Covered(PathBuf),
    NeedsConsent(PathBuf),
}

/// What a space root typed in Settings needs. The webview cannot tell a typed
/// path from an invented one, so a root outside every existing one is granted
/// only after the user confirms it in a native dialog the webview cannot drive.
pub fn plan_root_grant(registry: &WorkspaceRegistry, path: &str) -> Result<RootGrant, String> {
    let canonical = existing_dir(path)?;
    Ok(if registry.is_authorized(&canonical) {
        RootGrant::Covered(canonical)
    } else {
        RootGrant::NeedsConsent(canonical)
    })
}

/// Re-grants the roots saved spaces were using, once per process. Boot calls
/// it before any untrusted content renders; after that the window is shut, so
/// script in the webview cannot use it to grant itself a path later.
pub fn restore_roots(registry: &WorkspaceRegistry, paths: &[String]) -> Result<Vec<PathBuf>, String> {
    if registry.restore_spent.swap(true, Ordering::AcqRel) {
        return Err("workspace roots were already restored this session".into());
    }
    if paths.len() > MAX_RESTORED_ROOTS {
        return Err(format!("too many roots to restore: {}", paths.len()));
    }
    let mut granted = Vec::new();
    for path in paths {
        match existing_dir(path).and_then(|p| registry.authorize(p).map_err(|e| e.to_string())) {
            Ok(canonical) => granted.push(canonical),
            Err(e) => log::debug!("restore root {path:?} skipped: {e}"),
        }
    }
    Ok(granted)
}

/// Follows a `cd` the shell reported over OSC 7. The report is bytes any
/// program in the terminal could print, so a path outside the roots is granted
/// only when it is the live cwd of the shell or its foreground job.
pub fn grant_shell_cwd(
    registry: &WorkspaceRegistry,
    reported: &Path,
    live_cwds: impl FnOnce() -> Vec<PathBuf>,
) -> bool {
    let Ok(canonical) = std::fs::canonicalize(reported) else {
        return false;
    };
    if !canonical.is_dir() {
        return false;
    }
    if registry.is_authorized(&canonical) {
        return true;
    }
    if !live_cwds().contains(&canonical) {
        log::debug!("osc 7 {} is no live cwd; not granted", canonical.display());
        return false;
    }
    registry.authorize(&canonical).is_ok()
}

/// The kernel's view of a process's cwd, already canonical.
pub fn proc_cwd(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

#[tauri::command]
pub async fn workspace_current_dir(app: tauri::AppHandle) -> Result<String, String> {
    crate::modules::blocking::on_registry(app, |registry| {
        let canonical = registry
            .authorize(resolve_launch_dir())
            .map_err(|e| e.to_string())?;
        Ok(crate::modules::fs::to_canon(&canonical))
    })
    .await
}

#[tauri::command]
pub async fn workspace_restore_roots(
    paths: Vec<String>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let granted =
        crate::modules::blocking::on_registry(app, move |r| restore_roots(r, &paths)).await?;
    Ok(granted.iter().map(crate::modules::fs::to_canon).collect())
}

#[tauri::command]
pub async fn workspace_grant_root(
    path: String,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    use tauri::Manager;
    let app = window.app_handle().clone();
    let plan = crate::modules::blocking::on_registry(app.clone(), move |r| {
        plan_root_grant(r, &path)
    })
    .await?;
    let canonical = match plan {
        RootGrant::Covered(p) => p,
        RootGrant::NeedsConsent(p) => {
            if !ask_consent(&window, &p).await {
                return Err(format!("access to {} was not granted", p.display()));
            }
            app.state::<WorkspaceRegistry>()
                .authorize(&p)
                .map_err(|e| e.to_string())?
        }
    };
    Ok(crate::modules::fs::to_canon(&canonical))
}

async fn ask_consent(window: &tauri::WebviewWindow, path: &Path) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    let parent = window.clone();
    let path = path.display().to_string();
    let shown = window.run_on_main_thread(move || {
        let Ok(parent) = parent.gtk_window() else {
            return;
        };
        show_consent_dialog(&parent, &path, tx);
    });
    if shown.is_err() {
        return false;
    }
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(false))
        .await
        .unwrap_or(false)
}

fn show_consent_dialog(
    parent: &gtk::ApplicationWindow,
    path: &str,
    answer: std::sync::mpsc::Sender<bool>,
) {
    use gtk::prelude::*;
    let dialog = gtk::MessageDialog::new(
        Some(parent),
        gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
        gtk::MessageType::Question,
        gtk::ButtonsType::None,
        "Give Terra access to this folder?",
    );
    dialog.set_secondary_text(Some(&format!(
        "{path}\n\nThe explorer, editor, source control and terminals will be able to \
         read and change files inside it until Terra quits."
    )));
    dialog.add_button("Cancel", gtk::ResponseType::Cancel);
    dialog.add_button("Allow access", gtk::ResponseType::Accept);
    dialog.set_default_response(gtk::ResponseType::Cancel);
    dialog.connect_response(move |d, response| {
        let _ = answer.send(response == gtk::ResponseType::Accept);
        // SAFETY: the dialog is ours, and nothing touches it after this reply.
        unsafe { d.destroy() };
    });
    dialog.show_all();
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

    // pty_open takes its cwd from the webview, so a spawn must never be the
    // way a path outside every root becomes one.
    #[test]
    fn a_spawn_outside_every_root_opens_home_and_grants_nothing() {
        let allowed = tempdir("spawn-allowed");
        let foreign = tempdir("spawn-foreign");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).unwrap();
        let s = foreign.to_string_lossy().into_owned();
        assert_eq!(user_spawn_cwd_or_home(&reg, Some(&s)), None);
        assert!(!reg.is_authorized(&foreign));
        assert!(!reg.is_authorized(Path::new("/")));
    }

    #[test]
    fn user_spawn_cwd_or_home_keeps_an_authorized_dir() {
        let dir = tempdir("orhome-ok");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&dir).unwrap();
        let s = dir.to_string_lossy().into_owned();
        assert_eq!(user_spawn_cwd_or_home(&reg, Some(&s)), Some(s));
    }

    #[test]
    fn a_root_outside_every_root_needs_consent_and_is_not_granted_by_planning() {
        let allowed = tempdir("plan-allowed");
        let foreign = tempdir("plan-foreign");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).unwrap();

        let inner = allowed.join("inner");
        fs::create_dir(&inner).unwrap();
        assert_eq!(
            plan_root_grant(&reg, &inner.to_string_lossy()),
            Ok(RootGrant::Covered(inner.clone()))
        );
        assert_eq!(
            plan_root_grant(&reg, &foreign.to_string_lossy()),
            Ok(RootGrant::NeedsConsent(foreign.clone()))
        );
        assert_eq!(plan_root_grant(&reg, "/"), Ok(RootGrant::NeedsConsent("/".into())));
        assert!(!reg.is_authorized(&foreign));
        assert!(!reg.is_authorized(Path::new("/")));
    }

    #[test]
    fn a_root_must_be_an_existing_absolute_directory() {
        let dir = tempdir("plan-shape");
        let file = dir.join("f.txt");
        fs::write(&file, b"x").unwrap();
        let reg = WorkspaceRegistry::default();
        assert!(plan_root_grant(&reg, "relative/dir").is_err());
        assert!(plan_root_grant(&reg, &file.to_string_lossy()).is_err());
        assert!(plan_root_grant(&reg, &dir.join("missing").to_string_lossy()).is_err());
    }

    #[test]
    fn restoring_roots_works_once_per_process() {
        let saved = tempdir("restore-saved");
        let later = tempdir("restore-later");
        let reg = WorkspaceRegistry::default();

        let granted = restore_roots(
            &reg,
            &[saved.to_string_lossy().into_owned(), "/no/such/terra/dir".into()],
        )
        .expect("the boot restore");
        assert_eq!(granted, std::slice::from_ref(&saved));
        assert!(reg.is_authorized(&saved));

        assert!(restore_roots(&reg, &[later.to_string_lossy().into_owned()]).is_err());
        assert!(restore_roots(&reg, &["/".into()]).is_err());
        assert!(!reg.is_authorized(&later));
        assert!(!reg.is_authorized(Path::new("/")));
    }

    #[test]
    fn restoring_refuses_an_unbounded_list() {
        let reg = WorkspaceRegistry::default();
        let many = vec!["/tmp".to_string(); MAX_RESTORED_ROOTS + 1];
        assert!(restore_roots(&reg, &many).is_err());
        assert!(!reg.is_authorized(Path::new("/tmp")));
    }

    #[test]
    fn a_shell_cd_grants_its_live_cwd() {
        let dir = tempdir("osc7-live");
        let reg = WorkspaceRegistry::default();
        assert!(grant_shell_cwd(&reg, &dir, || vec![dir.clone()]));
        assert!(reg.is_authorized(&dir));
    }

    // Any program can print an OSC 7; only the shell's real cwd counts.
    #[test]
    fn a_reported_cwd_that_no_process_is_in_is_refused() {
        let spoofed = tempdir("osc7-spoofed");
        let real = tempdir("osc7-real");
        let reg = WorkspaceRegistry::default();
        assert!(!grant_shell_cwd(&reg, &spoofed, || vec![real.clone()]));
        assert!(!grant_shell_cwd(&reg, Path::new("/"), || vec![real.clone()]));
        assert!(!reg.is_authorized(&spoofed));
        assert!(!reg.is_authorized(Path::new("/")));
    }

    #[test]
    fn a_covered_report_skips_the_proc_lookup() {
        let dir = tempdir("osc7-covered");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&dir).unwrap();
        assert!(grant_shell_cwd(&reg, &dir, || panic!("no lookup needed")));
    }

    #[test]
    fn proc_cwd_reports_this_process() {
        let here = fs::canonicalize(env::current_dir().unwrap()).unwrap();
        assert_eq!(proc_cwd(std::process::id()), Some(here));
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
