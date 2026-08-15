use std::collections::BTreeMap;

use tauri::State;

use super::catalog::ServiceId;
use super::compose::{port_of, RenderEnv};
use super::detect::{detect_site, DetectedSite};
use super::project::{port_free, project_dir, write_project};
use super::runtime::{self, RuntimeKind, RuntimeStatus};
use super::spec::{validate, SiteSpec, StackSpec, ValidStack};
use crate::modules::fs::authorized_read;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};
use super::state::{InflightProc, ServicesState};
use super::status::{parse_ps, ServiceStatus};
use crate::modules::proc::hide_console;

#[tauri::command]
pub async fn services_runtime_probe() -> RuntimeStatus {
    tauri::async_runtime::spawn_blocking(runtime::detect)
        .await
        .unwrap_or(RuntimeStatus::NotFound)
}

#[derive(serde::Serialize)]
pub struct RuntimeProbeReport {
    pub docker: RuntimeStatus,
    pub podman: RuntimeStatus,
}

#[tauri::command]
pub async fn services_runtime_probe_all() -> RuntimeProbeReport {
    tauri::async_runtime::spawn_blocking(|| RuntimeProbeReport {
        docker: runtime::probe_status(RuntimeKind::Docker),
        podman: runtime::probe_status(RuntimeKind::Podman),
    })
    .await
    .unwrap_or(RuntimeProbeReport {
        docker: RuntimeStatus::NotFound,
        podman: RuntimeStatus::NotFound,
    })
}

fn resolve_runtime(forced: Option<RuntimeKind>) -> Result<RuntimeKind, String> {
    match forced {
        Some(runtime) => match runtime::probe_status(runtime) {
            RuntimeStatus::Ready { .. } => Ok(runtime),
            RuntimeStatus::NotFound => Err(format!("{} not found", runtime.bin())),
            RuntimeStatus::NoCompose { .. } => {
                Err(format!("{} has no compose provider", runtime.bin()))
            }
            RuntimeStatus::Unreachable { .. } => Err(format!("{} is not running", runtime.bin())),
        },
        None => match runtime::detect() {
            RuntimeStatus::Ready { runtime, .. } => Ok(runtime),
            RuntimeStatus::NotFound => Err("no container runtime found".into()),
            RuntimeStatus::NoCompose { runtime } => {
                Err(format!("{} has no compose provider", runtime.bin()))
            }
            RuntimeStatus::Unreachable { runtime } => {
                Err(format!("{} is not running", runtime.bin()))
            }
        },
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

pub fn authorize_mounts(
    registry: &WorkspaceRegistry,
    sites: &[SiteSpec],
) -> Result<BTreeMap<String, String>, String> {
    let mut mounts = BTreeMap::new();
    for site in sites {
        let canonical = authorized_read(registry, &site.root, &site.env)?;

        let docroot = if site.docroot == "." {
            canonical.clone()
        } else {
            canonical.join(&site.docroot)
        };
        let resolved = docroot
            .canonicalize()
            .map_err(|e| format!("{}: {e}", docroot.display()))?;
        if !resolved.starts_with(&canonical) {
            return Err(format!(
                "docroot for {} resolves outside its space root",
                site.slug
            ));
        }

        mounts.insert(site.slug.clone(), canonical.to_string_lossy().into_owned());
    }
    Ok(mounts)
}

pub fn run_as_for(runtime: RuntimeKind, root: &std::path::Path) -> Option<(u32, u32)> {
    #[cfg(target_os = "linux")]
    {
        if runtime == RuntimeKind::Docker {
            use std::os::unix::fs::MetadataExt;
            return std::fs::metadata(root).ok().map(|m| (m.uid(), m.gid()));
        }
        None
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (runtime, root);
        None
    }
}

fn shared_run_as(
    per_site: &[Option<(u32, u32)>],
    slugs: &[&str],
) -> Result<Option<(u32, u32)>, String> {
    let mut shared = None;
    let mut first_slug = None;
    for (index, owner) in per_site.iter().enumerate() {
        let Some(owner) = owner else {
            continue;
        };
        if let Some(existing) = shared {
            if existing != *owner {
                let first = first_slug.unwrap_or("unknown");
                let second = slugs.get(index).copied().unwrap_or("unknown");
                return Err(format!(
                    "sites {first} and {second} have different owners; a single php container cannot serve mixed-ownership spaces"
                ));
            }
        } else {
            shared = Some(*owner);
            first_slug = slugs.get(index).copied();
        }
    }
    Ok(shared)
}

#[tauri::command]
pub async fn sites_detect(
    root: String,
    env: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<DetectedSite, String> {
    let env = WorkspaceEnv::from_option(env);
    let path = authorized_read(&registry, &root, &env)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = std::collections::BTreeSet::new();
        let mut dirs = std::collections::BTreeSet::new();
        let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            match entry.file_type() {
                Ok(t) if t.is_dir() => {
                    dirs.insert(name);
                }
                Ok(_) => {
                    files.insert(name);
                }
                Err(_) => {}
            }
        }
        Ok(detect_site(&files, &dirs))
    })
    .await
    .map_err(|e| e.to_string())?
}

const OUTPUT_TAIL_CAP: usize = 256 * 1024;

fn read_capped<R: std::io::Read>(mut r: R) -> String {
    let mut tail: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match r.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                tail.extend_from_slice(&chunk[..n]);
                if tail.len() > OUTPUT_TAIL_CAP {
                    let drop = tail.len() - OUTPUT_TAIL_CAP;
                    tail.drain(..drop);
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&tail).into_owned()
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
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    let mut child = cmd.spawn().map_err(|e| format!("{bin}: {e}"))?;

    #[cfg(windows)]
    let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
        Ok(j) => Some(j),
        Err(_) => None,
    };

    // Take the pipes before handing the child to the registry: reading them
    // here is what lets the child stay registered (and therefore killable on
    // exit) for the whole invocation, instead of being owned by wait_with_output.
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let id = state.register(InflightProc {
        child,
        #[cfg(windows)]
        job,
    });

    // Read both pipes concurrently so neither blocks the other: draining
    // stdout to EOF first deadlocks when stderr fills while the child runs.
    let mut out = String::new();
    let mut err = String::new();
    let stdout_thread = stdout
        .take()
        .map(|pipe| std::thread::spawn(move || read_capped(pipe)));
    let stderr_thread = stderr
        .take()
        .map(|pipe| std::thread::spawn(move || read_capped(pipe)));
    if let Some(handle) = stdout_thread {
        out = handle.join().unwrap_or_default();
    }
    if let Some(handle) = stderr_thread {
        err = handle.join().unwrap_or_default();
    }

    let Some(mut proc) = state.finish(id) else {
        return Err("invocation was cancelled".into());
    };
    let status = proc.child.wait().map_err(|e| e.to_string())?;
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

fn compose_names(id: ServiceId) -> &'static [&'static str] {
    match id {
        ServiceId::Web => &["nginx", "php"],
        ServiceId::Mariadb => &["mariadb"],
        ServiceId::Postgres => &["postgres"],
        ServiceId::Redis => &["redis"],
        ServiceId::Mailpit => &["mailpit"],
        ServiceId::Adminer => &["adminer"],
    }
}

#[tauri::command]
pub async fn services_up(
    runtime: Option<RuntimeKind>,
    spec: StackSpec,
    targets: Vec<ServiceId>,
    state: State<'_, std::sync::Arc<ServicesState>>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    let stack = validate(spec)?;
    let runtime = resolve_runtime(runtime)?;
    preflight(&stack)?;

    let mounts = authorize_mounts(&registry, &stack.sites)?;
    let per_site: Vec<Option<(u32, u32)>> = stack
        .sites
        .iter()
        .map(|s| mounts.get(&s.slug).and_then(|p| run_as_for(runtime, std::path::Path::new(p))))
        .collect();
    let slugs: Vec<&str> = stack.sites.iter().map(|s| s.slug.as_str()).collect();
    let run_as = shared_run_as(&per_site, &slugs)?;

    let env = RenderEnv { run_as, mounts };
    write_project(&stack, &env)?;
    let names: Vec<&str> = targets
        .iter()
        .flat_map(|id| compose_names(*id))
        .copied()
        .collect();
    let mut args = vec!["up", "-d", "--build", "--remove-orphans"];
    args.extend(names);
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || compose(&state, runtime, &args))
        .await
        .map_err(|e| e.to_string())??;
    Ok(())
}

#[tauri::command]
pub async fn services_down(
    runtime: Option<RuntimeKind>,
    _spec: StackSpec,
    targets: Vec<ServiceId>,
    state: State<'_, std::sync::Arc<ServicesState>>,
) -> Result<(), String> {
    let runtime = resolve_runtime(runtime)?;
    let names: Vec<&str> = targets
        .iter()
        .flat_map(|id| compose_names(*id))
        .copied()
        .collect();
    let mut args = vec!["stop"];
    args.extend(names);
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || compose(&state, runtime, &args))
        .await
        .map_err(|e| e.to_string())??;
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
    runtime: Option<RuntimeKind>,
    state: State<'_, std::sync::Arc<ServicesState>>,
) -> Result<Vec<ServiceStatus>, String> {
    let runtime = resolve_runtime(runtime)?;
    let state = state.inner().clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        compose(&state, runtime, &["ps", "--format", "json"])
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(parse_ps(&out))
}

#[tauri::command]
pub async fn services_logs(
    runtime: Option<RuntimeKind>,
    service: String,
    state: State<'_, std::sync::Arc<ServicesState>>,
) -> Result<String, String> {
    let known = super::catalog::CATALOG
        .iter()
        .any(|d| format!("{:?}", d.id).to_lowercase() == service.to_lowercase());
    if !known && service != "nginx" && service != "php" {
        return Err(format!("unknown service: {service}"));
    }
    let runtime = resolve_runtime(runtime)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        compose(&state, runtime, &["logs", "--tail", "200", "--no-color", &service])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn services_delete_data(
    runtime: Option<RuntimeKind>,
    volume: String,
    state: State<'_, std::sync::Arc<ServicesState>>,
) -> Result<(), String> {
    check_volume(&volume)?;
    let runtime = resolve_runtime(runtime)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        compose(&state, runtime, &["down"])?;
        run_checked(&state, runtime.bin(), &["volume", "rm", &volume], None)?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::services::spec::{SiteKind, SiteSpec};
    use crate::modules::workspace::WorkspaceRegistry;

    fn site_at(root: &std::path::Path, docroot: &str) -> SiteSpec {
        SiteSpec {
            slug: "app".into(),
            root: root.to_string_lossy().into_owned(),
            docroot: docroot.into(),
            port: 8000,
            kind: SiteKind::Php,
            env: WorkspaceEnv::Local,
        }
    }

    #[test]
    fn an_unauthorized_root_never_reaches_the_yaml() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let reg = WorkspaceRegistry::default();
        let result = authorize_mounts(&reg, &[site_at(dir.path(), ".")]);
        assert!(result.is_err());
        Ok(())
    }

    #[test]
    fn the_string_checked_is_the_string_emitted() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        std::fs::create_dir(dir.path().join("public")).map_err(|e| e.to_string())?;
        let reg = WorkspaceRegistry::default();
        reg.authorize(dir.path()).map_err(|e| e.to_string())?;

        let mounts = authorize_mounts(&reg, &[site_at(dir.path(), "public")])?;
        let emitted = mounts.get("app").ok_or("app mount")?;
        let canonical = dir.path().canonicalize().map_err(|e| e.to_string())?;
        let expected = canonical.to_string_lossy().into_owned();
        assert_eq!(emitted, &expected);
        Ok(())
    }

    #[test]
    fn a_docroot_outside_the_space_root_is_rejected() -> Result<(), String> {
        #[cfg(unix)]
        {
            let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
            let reg = WorkspaceRegistry::default();
            reg.authorize(dir.path()).map_err(|e| e.to_string())?;
            let link = dir.path().join("out");
            std::os::unix::fs::symlink("/etc", &link).map_err(|e| e.to_string())?;
            assert!(authorize_mounts(&reg, &[site_at(dir.path(), "out")]).is_err());
        }
        Ok(())
    }

    #[test]
    fn shared_run_as_requires_one_owner_for_all_sites() -> Result<(), String> {
        assert_eq!(shared_run_as(&[None, None], &["a", "b"])?, None);
        assert_eq!(
            shared_run_as(&[Some((1000, 1000)), Some((1000, 1000))], &["a", "b"])?,
            Some((1000, 1000))
        );
        assert!(shared_run_as(&[Some((1000, 1000)), Some((1001, 1001))], &["a", "b"]).is_err());
        Ok(())
    }

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

    #[test]
    fn read_capped_keeps_only_the_output_tail() {
        let mut input = vec![b'a'; OUTPUT_TAIL_CAP + 3];
        input.extend_from_slice(b"xyz");

        let output = read_capped(std::io::Cursor::new(input));

        assert_eq!(output.len(), OUTPUT_TAIL_CAP);
        assert!(output.starts_with(&"a".repeat(OUTPUT_TAIL_CAP - 3)));
        assert!(output.ends_with("xyz"));
    }
}
