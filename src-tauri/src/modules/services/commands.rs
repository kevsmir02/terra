use tauri::State;

use super::compose::{port_of, RenderEnv};
use super::project::{port_free, project_dir, write_project};
use super::runtime::{self, RuntimeKind, RuntimeStatus};
use super::spec::{validate, StackSpec, ValidStack};
use super::state::ServicesState;
use super::status::{parse_ps, ServiceStatus};
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

fn run_checked(
    state: &ServicesState,
    bin: &str,
    args: &[&str],
    dir: Option<&std::path::Path>,
) -> Result<String, String> {
    let mut cmd = std::process::Command::new(bin);
    if let Some(dir) = dir {
        cmd.current_dir(dir);
    }
    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    hide_console(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("{bin}: {e}"))?;

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
        return Err("invocation was cancelled".into());
    };
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(err.trim().to_string());
    }
    Ok(out)
}

fn compose(
    state: &ServicesState,
    runtime: RuntimeKind,
    args: &[&str],
) -> Result<String, String> {
    let dir = project_dir()?;
    let mut argv = vec![
        "compose",
        "--project-directory",
        dir.to_str().ok_or("project directory is not valid utf-8")?,
    ];
    argv.extend_from_slice(args);
    run_checked(state, runtime.bin(), &argv, Some(&dir))
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

fn check_volume(name: &str) -> Result<(), String> {
    let known = super::catalog::CATALOG
        .iter()
        .filter_map(|d| d.volume)
        .any(|v| v == name);
    if known {
        Ok(())
    } else {
        Err(format!("unknown volume: {name}"))
    }
}

#[tauri::command]
pub async fn services_status(
    state: State<'_, ServicesState>,
) -> Result<Vec<ServiceStatus>, String> {
    let runtime = resolve_runtime()?;
    let out = compose(&state, runtime, &["ps", "--format", "json"])?;
    Ok(parse_ps(&out))
}

#[tauri::command]
pub async fn services_logs(
    service: String,
    state: State<'_, ServicesState>,
) -> Result<String, String> {
    let known = super::catalog::CATALOG
        .iter()
        .any(|d| format!("{:?}", d.id).to_lowercase() == service.to_lowercase());
    if !known && service != "nginx" && service != "php" {
        return Err(format!("unknown service: {service}"));
    }
    let runtime = resolve_runtime()?;
    compose(&state, runtime, &["logs", "--tail", "200", "--no-color", &service])
}

#[tauri::command]
pub async fn services_delete_data(
    volume: String,
    state: State<'_, ServicesState>,
) -> Result<(), String> {
    check_volume(&volume)?;
    let runtime = resolve_runtime()?;
    compose(&state, runtime, &["down"])?;
    run_checked(&state, runtime.bin(), &["volume", "rm", &volume], None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_terra_owned_volumes_can_be_deleted() {
        assert!(check_volume("terra_mariadb_data").is_ok());
        assert!(check_volume("terra_postgres_data").is_ok());
        // A volume name arriving from IPC must not be able to name someone
        // else's data.
        assert!(check_volume("postgres_data").is_err());
        assert!(check_volume("terra_mariadb_data extra").is_err());
        assert!(check_volume("../etc").is_err());
    }
}
