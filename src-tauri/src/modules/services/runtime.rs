use std::process::Command;

use crate::modules::proc::hide_console;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeKind {
    Docker,
    Podman,
}

impl RuntimeKind {
    pub fn bin(self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::Podman => "podman",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    Missing,
    NoCompose,
    Unreachable,
    Ready { version: String },
}

impl Probe {
    fn rank(&self) -> u8 {
        match self {
            Self::Missing => 0,
            Self::NoCompose => 1,
            Self::Unreachable => 2,
            Self::Ready { .. } => 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum RuntimeStatus {
    NotFound,
    NoCompose { runtime: RuntimeKind },
    Unreachable { runtime: RuntimeKind },
    Ready { runtime: RuntimeKind, version: String },
}

fn status_for(runtime: RuntimeKind, probe: &Probe) -> RuntimeStatus {
    match probe {
        Probe::Missing => RuntimeStatus::NotFound,
        Probe::NoCompose => RuntimeStatus::NoCompose { runtime },
        Probe::Unreachable => RuntimeStatus::Unreachable { runtime },
        Probe::Ready { version } => RuntimeStatus::Ready { runtime, version: version.clone() },
    }
}

/// Docker wins ties: it is the more common setup, and a tie means both are
/// equally close to working.
pub fn select(docker: &Probe, podman: &Probe) -> RuntimeStatus {
    if podman.rank() > docker.rank() {
        status_for(RuntimeKind::Podman, podman)
    } else {
        status_for(RuntimeKind::Docker, docker)
    }
}

fn run(bin: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn probe(runtime: RuntimeKind) -> Probe {
    let bin = runtime.bin();
    if which::which(bin).is_err() {
        return Probe::Missing;
    }
    let Some(version) = run(bin, &["compose", "version", "--short"]) else {
        return Probe::NoCompose;
    };
    if run(bin, &["info", "--format", "{{.ServerVersion}}"]).is_none() {
        return Probe::Unreachable;
    }
    Probe::Ready { version }
}

pub fn probe_status(runtime: RuntimeKind) -> RuntimeStatus {
    status_for(runtime, &probe(runtime))
}

pub fn detect() -> RuntimeStatus {
    select(&probe(RuntimeKind::Docker), &probe(RuntimeKind::Podman))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready() -> Probe {
        Probe::Ready { version: "2.29.0".into() }
    }

    #[test]
    fn prefers_docker_when_both_are_ready() {
        assert_eq!(
            select(&ready(), &ready()),
            RuntimeStatus::Ready { runtime: RuntimeKind::Docker, version: "2.29.0".into() }
        );
    }

    #[test]
    fn falls_back_to_podman_when_docker_is_not_ready() {
        assert_eq!(
            select(&Probe::Unreachable, &ready()),
            RuntimeStatus::Ready { runtime: RuntimeKind::Podman, version: "2.29.0".into() }
        );
    }

    #[test]
    fn reports_the_most_actionable_failure() {
        // An unreachable daemon is one click from working; a missing compose
        // provider needs an install. Neither should be reported as "not found".
        assert_eq!(
            select(&Probe::Unreachable, &Probe::Missing),
            RuntimeStatus::Unreachable { runtime: RuntimeKind::Docker }
        );
        assert_eq!(
            select(&Probe::Missing, &Probe::NoCompose),
            RuntimeStatus::NoCompose { runtime: RuntimeKind::Podman }
        );
        assert_eq!(
            select(&Probe::NoCompose, &Probe::Unreachable),
            RuntimeStatus::Unreachable { runtime: RuntimeKind::Podman }
        );
    }

    #[test]
    fn reports_not_found_only_when_neither_binary_exists() {
        assert_eq!(select(&Probe::Missing, &Probe::Missing), RuntimeStatus::NotFound);
    }
}
