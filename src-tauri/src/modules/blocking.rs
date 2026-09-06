use tauri::{AppHandle, Manager};

use crate::modules::workspace::WorkspaceRegistry;

/// Runs `f` on the blocking pool, handing it the app so it can reach state.
///
/// The command macro expands a non-`async` `#[tauri::command]` body inline, and
/// on this platform the IPC message arrives on the WebKitGTK signal handler,
/// which runs on the GTK main loop. A sync command that walks a tree, greps a
/// repo or copies a directory therefore blocks painting and input, not just the
/// IPC channel. Anything that touches the disk or spawns a process goes here.
pub async fn on_app<F, T>(app: AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&app))
        .await
        .map_err(|e| e.to_string())?
}

/// The common case: the work only needs the workspace registry.
pub async fn on_registry<F, T>(app: AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&WorkspaceRegistry) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    on_app(app, move |app| f(&app.state::<WorkspaceRegistry>())).await
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    /// Commands that stay synchronous on purpose. Each entry is a promise that
    /// the body does no disk walk, no process spawn and no unbounded wait.
    const SYNC_BY_DESIGN: &[(&str, &str)] = &[
        ("get_launch_dir", "reads a Mutex<Option<String>> already in memory"),
        ("get_launch_files", "drains a Vec already in memory"),
        ("pty_write", "the keystroke path; a hop to the pool would add latency to every character"),
        ("pty_resize", "an ioctl on a fd held in memory"),
        ("pty_close", "signals the session; the threads wind down on their own"),
        ("pty_close_all", "same, over the session map"),
        ("pty_has_foreground_process", "one /proc read on a known pid"),
        ("pty_has_foreground_job", "same"),
        ("pty_list_shells", "reads the shell list captured at startup"),
        ("lsp_host_pid", "returns std::process::id()"),
        ("lsp_kill", "sends a signal to a process group"),
        ("agent_enable_hooks", "one small JSON file in the user's config dir, on an explicit click"),
        ("agent_hooks_status", "same, one read"),
    ];

    fn rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("read src dir") {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                rs_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    /// A non-`async` `#[tauri::command]` body is expanded inline by the macro
    /// and, on this platform, runs on the GTK main loop, so a tree walk or a
    /// directory copy freezes painting and input. Anything not on the list
    /// above must go through this module.
    #[test]
    fn every_command_leaves_the_ui_thread_unless_listed() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rs_files(&src, &mut files);
        assert!(!files.is_empty(), "found no sources to scan");

        let mut offenders = Vec::new();
        for file in &files {
            let text = std::fs::read_to_string(file).expect("read source");
            let mut lines = text.lines().peekable();
            while let Some(line) = lines.next() {
                if line.trim() != "#[tauri::command]" {
                    continue;
                }
                // Skip attributes and doc comments between the marker and the fn.
                let signature = lines
                    .by_ref()
                    .find(|l| l.contains("fn "))
                    .unwrap_or_default();
                if signature.contains("async fn ") {
                    continue;
                }
                let name = signature
                    .split("fn ")
                    .nth(1)
                    .and_then(|rest| rest.split(['(', '<']).next())
                    .unwrap_or("<unparsed>")
                    .trim()
                    .to_string();
                if SYNC_BY_DESIGN.iter().any(|(listed, _)| *listed == name) {
                    continue;
                }
                offenders.push(format!("{}: {name}", file.display()));
            }
        }

        assert!(
            offenders.is_empty(),
            "sync commands run on the GTK main loop. Wrap these in \
             modules::blocking, or add them to SYNC_BY_DESIGN with a reason: {offenders:#?}"
        );
    }
}
