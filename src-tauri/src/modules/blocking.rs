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

    /// Async commands whose body touches `std::fs` directly on purpose. Each
    /// entry is a promise that the call is bounded and small.
    const INLINE_FS_BY_DESIGN: &[(&str, &str)] = &[];

    /// Source with every string literal and line comment blanked out, so a
    /// brace or a `fs::` inside either cannot confuse the scan.
    fn code_only(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut chars = text.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '"' => {
                    out.push('"');
                    while let Some(s) = chars.next() {
                        match s {
                            '\\' => {
                                chars.next();
                            }
                            '"' => break,
                            '\n' => out.push('\n'),
                            _ => {}
                        }
                    }
                    out.push('"');
                }
                '/' if chars.peek() == Some(&'/') => {
                    for s in chars.by_ref() {
                        if s == '\n' {
                            out.push('\n');
                            break;
                        }
                    }
                }
                _ => out.push(c),
            }
        }
        out
    }

    /// `(name, body)` for every `async fn` marked `#[tauri::command]`.
    fn async_command_bodies(text: &str) -> Vec<(String, String)> {
        let code = code_only(text);
        let mut out = Vec::new();
        let mut rest = code.as_str();
        while let Some(at) = rest.find("#[tauri::command]") {
            rest = &rest[at + "#[tauri::command]".len()..];
            let Some(fn_at) = rest.find("fn ") else { break };
            let head = &rest[..fn_at];
            let after = &rest[fn_at + 3..];
            if !head.trim_end().ends_with("async") {
                continue;
            }
            let name = after
                .split(['(', '<'])
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            let Some(open) = after
                .find(')')
                .and_then(|close| after[close..].find('{').map(|b| close + b))
            else {
                continue;
            };
            let mut depth = 0usize;
            let mut end = open;
            for (i, c) in after[open..].char_indices() {
                match c {
                    '{' => depth += 1,
                    '}' => {
                        depth -= 1;
                        if depth == 0 {
                            end = open + i;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            out.push((name, after[open..=end].to_string()));
        }
        out
    }

    /// The body with the arguments of every hop to the pool removed: IO inside
    /// a `spawn_blocking` or `on_app` closure is exactly where it belongs.
    fn outside_hops(body: &str) -> String {
        const HOPS: &[&str] = &["spawn_blocking(", "on_app(", "on_registry(", "blocking("];
        let mut out = String::with_capacity(body.len());
        let mut i = 0;
        while i < body.len() {
            let hop = HOPS.iter().find(|h| body[i..].starts_with(**h));
            let Some(hop) = hop else {
                let c = body[i..].chars().next().expect("in bounds");
                out.push(c);
                i += c.len_utf8();
                continue;
            };
            let mut depth = 0usize;
            let mut j = i + hop.len() - 1;
            for (k, c) in body[j..].char_indices() {
                match c {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            j += k;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            out.push_str("hop()");
            i = j + 1;
        }
        out
    }

    fn touches_std_fs(body: &str, file_imports_std_fs: bool) -> bool {
        let body = &outside_hops(body);
        if body.contains("std::fs::") {
            return true;
        }
        file_imports_std_fs
            && body.match_indices("fs::").any(|(i, _)| {
                body[..i]
                    .chars()
                    .next_back()
                    .is_none_or(|p| !(p == ':' || p == '_' || p.is_alphanumeric()))
            })
    }

    #[test]
    fn the_std_fs_scan_catches_inline_calls_and_ignores_the_hop() {
        let src = r#"
            use std::fs;
            #[tauri::command]
            pub async fn inline_read(path: String, s: State<'_, X>) -> Result<(), String> {
                let _ = format!("{}", "}");
                fs::read(&path).map(drop).map_err(|e| e.to_string())
            }
            #[tauri::command]
            pub async fn hopped(path: String, app: AppHandle) -> Result<(), String> {
                // std::fs::read here would be fine, it is a comment
                blocking(app, move |r| core(r, &path)).await
            }
            #[tauri::command]
            pub async fn module_path(app: AppHandle) -> Result<String, String> {
                Ok(crate::modules::fs::to_canon("/"))
            }
            #[tauri::command]
            pub async fn spawned(path: String) -> Result<Vec<u8>, String> {
                let bytes = tauri::async_runtime::spawn_blocking(move || {
                    std::fs::read(&path).map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| e.to_string())??;
                Ok(bytes)
            }
            #[tauri::command]
            pub async fn after_the_hop(app: AppHandle) -> Result<u64, String> {
                blocking(app, |_| Ok(())).await?;
                Ok(std::fs::metadata("/").map(|m| m.len()).unwrap_or(0))
            }
        "#;
        let bodies = async_command_bodies(src);
        let names: Vec<_> = bodies.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            ["inline_read", "hopped", "module_path", "spawned", "after_the_hop"]
        );
        let flagged: Vec<_> = bodies
            .iter()
            .filter(|(_, b)| touches_std_fs(b, true))
            .map(|(n, _)| n.as_str())
            .collect();
        assert_eq!(flagged, ["inline_read", "after_the_hop"]);
    }

    /// An async command body still runs on the async runtime's worker, so a
    /// 50 MB read or a directory walk there stalls every other command queued
    /// behind it. Disk IO goes through `on_registry` / `on_app` instead.
    #[test]
    fn async_commands_reach_the_disk_only_through_the_blocking_pool() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rs_files(&src, &mut files);

        let mut offenders = Vec::new();
        for file in &files {
            let text = std::fs::read_to_string(file).expect("read source");
            let imports = text.contains("use std::fs") || text.contains("use std::{fs");
            for (name, body) in async_command_bodies(&text) {
                if touches_std_fs(&body, imports)
                    && !INLINE_FS_BY_DESIGN.iter().any(|(listed, _)| *listed == name)
                {
                    offenders.push(format!("{}: {name}", file.display()));
                }
            }
        }

        assert!(
            offenders.is_empty(),
            "async commands calling std::fs inline block a runtime worker. Move the \
             IO into a core run through modules::blocking, or add them to \
             INLINE_FS_BY_DESIGN with a reason: {offenders:#?}"
        );
    }
}
