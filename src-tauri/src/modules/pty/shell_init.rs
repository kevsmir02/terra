use std::path::PathBuf;

use portable_pty::CommandBuilder;

use crate::modules::workspace::{self, WorkspaceEnv};

const FISH_REINSTALL_PROMPT: &str =
    "functions -q __terra_install_prompt; and __terra_install_prompt";

pub fn build_command(
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    shell: Option<String>,
) -> Result<CommandBuilder, String> {
    let shell = sanitize_shell_override(shell);
    let _ = workspace;
    unix::build(cwd, shell)
}

// Honor the override only if it matches an enumerated shell, so a tampered
// setting can't spawn an arbitrary binary across the IPC boundary.
fn sanitize_shell_override(shell: Option<String>) -> Option<String> {
    let candidate = shell
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    let target = std::fs::canonicalize(&candidate).ok();
    let allowed = list_shells().into_iter().any(|s| {
        s.path == candidate || (target.is_some() && std::fs::canonicalize(&s.path).ok() == target)
    });
    if allowed {
        Some(candidate)
    } else {
        log::warn!("ignoring non-enumerated shell override '{candidate}'");
        None
    }
}

pub fn detect_shell_name() -> String {
    let (_, path) = unix::Shell::detect();
    path.rsplit('/').next().unwrap_or("").to_string()
}

#[derive(serde::Serialize)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    /// True when Terra injects OSC 7/133 integration for this shell (cwd
    /// tracking, agent detection). Others spawn bare.
    pub integrated: bool,
}

pub fn list_shells() -> Vec<ShellInfo> {
    unix::list_shells()
}

fn ensure_utf8_locale(cmd: &mut CommandBuilder) {
    let is_utf8 = |v: &str| {
        let up = v.to_ascii_uppercase();
        up.contains("UTF-8") || up.contains("UTF8")
    };
    let already_utf8 = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|k| std::env::var(k).ok().as_deref().is_some_and(is_utf8));
    if already_utf8 {
        return;
    }
    let fallback = "C.UTF-8";
    cmd.env("LANG", fallback);
}

fn apply_common(cmd: &mut CommandBuilder, cwd: Option<String>) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERRA_TERMINAL", "1");
    // Pre-rename hooks in the user's agent config gate on `$TERAX_TERMINAL`.
    // Export it too so they keep firing until they're reinstalled.
    cmd.env("TERAX_TERMINAL", "1");
    for (key, value) in workspace::appimage_env_overrides() {
        match value {
            Some(v) => {
                cmd.env(key, v);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
    ensure_utf8_locale(cmd);

    let resolved_cwd = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| workspace::launch_cwd_snapshot().filter(|p| p.is_dir()))
        .or_else(|| dirs::home_dir().filter(|p| p.is_dir()));
    if let Some(cwd) = resolved_cwd {
        log::info!("pty cwd: {}", cwd.display());
        cmd.cwd(cwd);
    } else {
        log::warn!("pty cwd: no usable directory, inheriting from process");
    }
}

mod unix {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use portable_pty::CommandBuilder;

    const ZSHENV: &str = include_str!("scripts/zshenv.zsh");
    const ZPROFILE: &str = include_str!("scripts/zprofile.zsh");
    const ZLOGIN: &str = include_str!("scripts/zlogin.zsh");
    const ZSHRC: &str = include_str!("scripts/zshrc.zsh");
    const BASHRC: &str = include_str!("scripts/bashrc.bash");
    const FISH_INIT: &str = include_str!("scripts/init.fish");

    pub enum Shell {
        Zsh,
        Bash,
        Fish,
        Other,
    }

    impl Shell {
        pub fn classify(path: &str) -> Shell {
            match path.rsplit('/').next().unwrap_or("") {
                "zsh" => Shell::Zsh,
                "bash" => Shell::Bash,
                "fish" => Shell::Fish,
                _ => Shell::Other,
            }
        }

        pub fn detect() -> (Shell, String) {
            let path = login_shell()
                .or_else(|| std::env::var("SHELL").ok())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "/bin/zsh".into());
            (Self::classify(&path), path)
        }

        // A configured override wins only when it points at a real file;
        // otherwise fall back to the user's login shell.
        pub fn resolve(shell_override: Option<String>) -> (Shell, String) {
            if let Some(path) = shell_override
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            {
                if Path::new(&path).is_file() {
                    return (Self::classify(&path), path);
                }
                log::warn!("configured shell '{path}' not found, using auto-detect");
            }
            Self::detect()
        }
    }

    fn login_shell() -> Option<String> {
        use std::ffi::CStr;
        unsafe {
            let uid = libc::getuid();
            let pw = libc::getpwuid(uid);
            if pw.is_null() {
                return None;
            }
            let shell_ptr = (*pw).pw_shell;
            if shell_ptr.is_null() {
                return None;
            }
            CStr::from_ptr(shell_ptr).to_str().ok().map(String::from)
        }
    }

    pub fn list_shells() -> Vec<super::ShellInfo> {
        use std::collections::HashSet;
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let (_, login) = Shell::detect();
        let mut candidates = vec![login];
        if let Ok(content) = fs::read_to_string("/etc/shells") {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                candidates.push(line.to_string());
            }
        }
        for path in candidates {
            if !seen.insert(path.clone()) || !Path::new(&path).is_file() {
                continue;
            }
            let integrated = !matches!(Shell::classify(&path), Shell::Other);
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            out.push(super::ShellInfo {
                name,
                path,
                integrated,
            });
        }
        out
    }

    pub fn build(
        cwd: Option<String>,
        shell_override: Option<String>,
    ) -> Result<CommandBuilder, String> {
        let (shell, shell_path) = Shell::resolve(shell_override);
        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd);
        apply_shell_init(&mut cmd, &shell, &shell_path);
        Ok(cmd)
    }

    fn apply_shell_init(cmd: &mut CommandBuilder, shell: &Shell, shell_path: &str) {
        match shell {
            Shell::Zsh => {
                match prepare_zdotdir() {
                    Ok(zdotdir) => {
                        // Guard against Terra-in-Terra :)
                        if let Ok(user_zd) = std::env::var("ZDOTDIR") {
                            if Path::new(&user_zd) != zdotdir.as_path() {
                                cmd.env("TERRA_USER_ZDOTDIR", user_zd);
                            }
                        }
                        cmd.env("ZDOTDIR", &zdotdir);
                    }
                    Err(e) => {
                        log::warn!("zsh shell integration disabled: {e}");
                    }
                }
                // Login shell so /etc/zprofile runs path_helper on macOS — without
                // this, GUI-launched apps get a minimal PATH missing Homebrew.
                cmd.arg("-l");
            }
            Shell::Bash => {
                match prepare_bash_rcfile() {
                    Ok(rc) => {
                        cmd.arg("--rcfile");
                        cmd.arg(rc);
                    }
                    Err(e) => {
                        log::warn!("bash shell integration disabled: {e}");
                    }
                }
                // bash ignores --rcfile under -l, so we use -i and source
                // /etc/profile from inside our rcfile to emulate login init.
                cmd.arg("-i");
            }
            Shell::Fish => {
                if let Err(e) = prepare_fish_conf_d() {
                    log::warn!("fish shell integration disabled: {e}");
                }
                // fish 4.0+ writes its own OSC 133 A/B; ours would double it.
                cmd.env("fish_features", "no-mark-prompt");
                cmd.arg("-i");
                // Re-assert our prompt after config.fish (-C runs last), so a
                // framework prompt (starship etc.) loaded there can't override
                // the markers and break cwd tracking.
                cmd.arg("-C");
                cmd.arg(super::FISH_REINSTALL_PROMPT);
            }
            Shell::Other => {
                log::info!(
                    "unsupported shell '{}', spawning without integration",
                    shell_path
                );
            }
        }
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let root = home.join(".cache").join("terra").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_zdotdir() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("zsh");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join(".zshenv"), ZSHENV)?;
        write_if_changed(&dir.join(".zprofile"), ZPROFILE)?;
        write_if_changed(&dir.join(".zshrc"), ZSHRC)?;
        write_if_changed(&dir.join(".zlogin"), ZLOGIN)?;
        Ok(dir)
    }

    fn prepare_bash_rcfile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("bash");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let rc = dir.join("bashrc");
        write_if_changed(&rc, BASHRC)?;
        Ok(rc)
    }

    fn prepare_fish_conf_d() -> Result<(), String> {
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let dir = home.join(".config").join("fish").join("conf.d");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        // conf.d is sourced wholesale; the pre-rename copy would double every
        // prompt hook it still recognises.
        let _ = fs::remove_file(dir.join("terax.fish"));
        write_if_changed(&dir.join("terra.fish"), FISH_INIT)?;
        Ok(())
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        // Atomic replace: a parallel shell startup must never source a half-written file.
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__terra_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn classify_maps_known_shells() {
            assert!(matches!(Shell::classify("/bin/zsh"), Shell::Zsh));
            assert!(matches!(Shell::classify("/usr/bin/bash"), Shell::Bash));
            assert!(matches!(
                Shell::classify("/opt/homebrew/bin/fish"),
                Shell::Fish
            ));
            assert!(matches!(Shell::classify("/bin/sh"), Shell::Other));
            assert!(matches!(Shell::classify("/usr/bin/nu"), Shell::Other));
        }

        #[test]
        fn resolve_uses_an_existing_override() {
            let exe = std::env::current_exe().unwrap();
            let path = exe.to_string_lossy().into_owned();
            let (_, resolved) = Shell::resolve(Some(path.clone()));
            assert_eq!(resolved, path);
        }

        #[test]
        fn resolve_falls_back_when_override_missing() {
            let (_, path) = Shell::resolve(Some("/no/such/shell/xyz".into()));
            assert!(!path.is_empty());
            assert_ne!(path, "/no/such/shell/xyz");
        }

        #[test]
        fn resolve_falls_back_on_empty_override() {
            let (_, fallback) = Shell::resolve(Some("   ".into()));
            let (_, detected) = Shell::detect();
            assert_eq!(fallback, detected);
        }

        #[test]
        fn builds_unix_fish_launch_with_post_config_rewrap() {
            let mut cmd = CommandBuilder::new("/usr/bin/fish");
            apply_shell_init(&mut cmd, &Shell::Fish, "/usr/bin/fish");
            let argv: Vec<_> = cmd
                .get_argv()
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            assert_eq!(
                argv,
                vec![
                    "/usr/bin/fish".to_string(),
                    "-i".to_string(),
                    "-C".to_string(),
                    super::super::FISH_REINSTALL_PROMPT.to_string(),
                ]
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_shell_override;

    #[test]
    fn rejects_non_enumerated_override() {
        let exe = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(sanitize_shell_override(Some(exe)), None);
    }

    #[test]
    fn empty_or_missing_override_is_none() {
        assert_eq!(sanitize_shell_override(Some("   ".into())), None);
        assert_eq!(sanitize_shell_override(None), None);
    }
}
