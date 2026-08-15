use tauri::State;

use super::compose::{port_of, RenderEnv};
use super::project::{port_free, project_dir, write_project};
use super::runtime::{self, RuntimeKind, RuntimeStatus};
use super::spec::{validate, StackSpec, ValidStack};
use super::state::ServicesState;
use crate::modules::proc::hide_console;

#[tauri::command]
pub async fn services_runtime_probe() -> RuntimeStatus {
    tauri::async_runtime::spawn_blocking(runtime::detect)
        .await
        .unwrap_or(RuntimeStatus::NotFound)
}

fn resolve_runtime() -> Result<RuntimeKind, String> {
    match runtime::detect() {
        RuntimeStatus::Ready { runtime, .. } => Ok(runtime),
        RuntimeStatus::NotFound => Err("no container runtime found".into()),
        RuntimeStatus::NoCompose { runtime } => {
            Err(format!("{} has no compose provider", runtime.bin()))
        }
        RuntimeStatus::Unreachable { runtime } => {
            Err(format!("{} is not running", runtime.bin()))
        }
    }
}

fn preflight(stack: &ValidStack) -> Result<(), String> {
    for id in &stack.services {
        for (i, _) in super::catalog::def(*id).ports.iter().enumerate() {
            let p = port_of(stack, *id, i);
            if !port_free(p) {
                return Err(format!(
                    "port {p} is already in use. Stop whatever is using it, or change the port."
                ));
            }
        }
    }
    for site in &stack.sites {
        if !port_free(site.port) {
            return Err(format!("port {} for site {} is already in use", site.port, site.slug));
        }
    }
    Ok(())
}

fn compose(
    state: &ServicesState,
    runtime: RuntimeKind,
    args: &[&str],
) -> Result<String, String> {
    let dir = project_dir()?;
    let mut cmd = std::process::Command::new(runtime.bin());
    cmd.arg("compose")
        .arg("--project-directory")
        .arg(&dir)
        .args(args)
        .current_dir(&dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    hide_console(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("{}: {e}", runtime.bin()))?;

    // Take the pipes before handing the child to the registry: reading them
    // here is what lets the child stay registered (and therefore killable on
    // exit) for the whole invocation, instead of being owned by wait_with_output.
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let id = state.register(child);

    // Read both pipes concurrently so neither blocks the other: draining
    // stdout to EOF first deadlocks when stderr fills while the child runs.
    let mut out = String::new();
    let mut err = String::new();
    let stdout_thread = stdout.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut pipe, &mut buf);
            String::from_utf8_lossy(&buf).to_string()
        })
    });
    let stderr_thread = stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut pipe, &mut buf);
            String::from_utf8_lossy(&buf).to_string()
        })
    });
    if let Some(handle) = stdout_thread {
        out = handle.join().unwrap_or_default();
    }
    if let Some(handle) = stderr_thread {
        err = handle.join().unwrap_or_default();
    }

    let Some(mut child) = state.finish(id) else {
        return Err("compose invocation was cancelled".into());
    };
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(err.trim().to_string());
    }
    Ok(out)
}

#[tauri::command]
pub async fn services_up(
    spec: StackSpec,
    state: State<'_, ServicesState>,
) -> Result<(), String> {
    let stack = validate(spec)?;
    let runtime = resolve_runtime()?;
    preflight(&stack)?;
    let env = RenderEnv { run_as: None, mounts: Default::default() };
    write_project(&stack, &env)?;
    compose(&state, runtime, &["up", "-d"])?;
    Ok(())
}

#[tauri::command]
pub async fn services_down(
    spec: StackSpec,
    state: State<'_, ServicesState>,
) -> Result<(), String> {
    let _ = validate(spec)?;
    let runtime = resolve_runtime()?;
    compose(&state, runtime, &["down"])?;
    Ok(())
}
