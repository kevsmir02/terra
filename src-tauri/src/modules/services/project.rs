use std::path::{Path, PathBuf};

use super::compose::{render_compose, RenderEnv};
use super::dockerfile::{render_dev_ini, render_php_dockerfile};
use super::spec::ValidStack;
use super::vhost::render_vhosts;

pub fn project_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("no data directory for this platform")?;
    let dir = base.join("terra").join("services");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

pub fn write_compose_to(dir: &Path, yaml: &str) -> Result<PathBuf, String> {
    let path = dir.join("compose.yaml");
    std::fs::write(&path, yaml).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

pub fn write_project(stack: &ValidStack, env: &RenderEnv) -> Result<PathBuf, String> {
    let dir = project_dir()?;
    write_compose_to(&dir, &render_compose(stack, env))?;

    let conf_d = dir.join("nginx").join("conf.d");
    std::fs::create_dir_all(&conf_d).map_err(|e| format!("{}: {e}", conf_d.display()))?;
    std::fs::write(conf_d.join("sites.conf"), render_vhosts(&stack.sites))
        .map_err(|e| e.to_string())?;

    let php = dir.join("php");
    std::fs::create_dir_all(&php).map_err(|e| format!("{}: {e}", php.display()))?;
    std::fs::write(php.join("Dockerfile"), render_php_dockerfile())
        .map_err(|e| e.to_string())?;
    std::fs::write(php.join("terra-dev.ini"), render_dev_ini())
        .map_err(|e| e.to_string())?;

    Ok(dir)
}

pub fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bound_port_is_reported_as_busy() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(!port_free(port));
        drop(listener);
        assert!(port_free(port));
    }

    #[test]
    fn writing_the_project_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let a = write_compose_to(dir.path(), "name: terra\n").unwrap();
        let b = write_compose_to(dir.path(), "name: terra\n").unwrap();
        assert_eq!(a, b);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "name: terra\n");
    }
}
