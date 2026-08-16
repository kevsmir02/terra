use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::runtime::RuntimeKind;
use crate::modules::sync::MutexExt;

/// Long enough that the status pollers stop re-probing on every tick, short
/// enough that a runtime the user just started is picked up on its own.
const RUNTIME_TTL: Duration = Duration::from_secs(10);

struct CachedRuntime {
    forced: Option<RuntimeKind>,
    result: Result<RuntimeKind, String>,
    at: Instant,
}

pub struct InflightProc {
    pub child: Child,
    #[cfg(windows)]
    pub job: Option<crate::modules::proc::job::ProcessJob>,
}

impl InflightProc {
    pub fn kill(&mut self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as libc::pid_t), libc::SIGKILL);
        }
        let _ = self.child.kill();
        #[cfg(windows)]
        {
            self.job = None;
        }
    }
}

#[derive(Default)]
pub struct ServicesState {
    inflight: Mutex<HashMap<u64, InflightProc>>,
    next: AtomicU64,
    runtime: Mutex<Option<CachedRuntime>>,
}

impl ServicesState {
    /// Probing costs up to four subprocess spawns, and two pollers ask for it
    /// every few seconds. A miss returns `None` and the caller probes.
    pub fn cached_runtime(&self, forced: Option<RuntimeKind>) -> Option<Result<RuntimeKind, String>> {
        self.cached_runtime_at(forced, Instant::now())
    }

    // `now` is a parameter so expiry is testable without sleeping, and without
    // subtracting from `Instant::now()`, which panics near boot.
    fn cached_runtime_at(
        &self,
        forced: Option<RuntimeKind>,
        now: Instant,
    ) -> Option<Result<RuntimeKind, String>> {
        let guard = self.runtime.lock_or_recover();
        let hit = guard.as_ref()?;
        if hit.forced != forced || now.saturating_duration_since(hit.at) >= RUNTIME_TTL {
            return None;
        }
        Some(hit.result.clone())
    }

    pub fn cache_runtime(&self, forced: Option<RuntimeKind>, result: Result<RuntimeKind, String>) {
        *self.runtime.lock_or_recover() = Some(CachedRuntime {
            forced,
            result,
            at: Instant::now(),
        });
    }

    pub fn register(&self, proc: InflightProc) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.inflight.lock_or_recover().insert(id, proc);
        id
    }

    pub fn finish(&self, id: u64) -> Option<InflightProc> {
        self.inflight.lock_or_recover().remove(&id)
    }

    /// Containers are deliberately left running. Only the compose CLI
    /// invocations Terra started are killed.
    pub fn kill_all(&self) {
        for (_, mut proc) in self.inflight.lock_or_recover().drain() {
            proc.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cached_runtime_is_only_reused_for_the_same_choice() {
        let state = ServicesState::default();
        assert!(state.cached_runtime(None).is_none());

        state.cache_runtime(None, Ok(RuntimeKind::Docker));
        assert_eq!(state.cached_runtime(None), Some(Ok(RuntimeKind::Docker)));

        // Switching the override must not be answered from the auto entry.
        assert!(state.cached_runtime(Some(RuntimeKind::Podman)).is_none());
    }

    #[test]
    fn a_cached_failure_is_reused_too() {
        // The failing probe is the expensive one: `docker info` against a dead
        // daemon is what the pollers would otherwise pay for every tick.
        let state = ServicesState::default();
        state.cache_runtime(None, Err("docker is not running".into()));
        assert_eq!(
            state.cached_runtime(None),
            Some(Err("docker is not running".into()))
        );
    }

    #[test]
    fn a_stale_entry_is_a_miss() {
        let state = ServicesState::default();
        state.cache_runtime(None, Ok(RuntimeKind::Docker));

        let just_inside = Instant::now() + RUNTIME_TTL - Duration::from_millis(1);
        assert!(state.cached_runtime_at(None, just_inside).is_some());

        let past_ttl = Instant::now() + RUNTIME_TTL;
        assert!(state.cached_runtime_at(None, past_ttl).is_none());
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;
    use std::os::unix::process::CommandExt;

    #[test]
    fn kill_terminates_the_process_group() {
        let mut command = std::process::Command::new("sh");
        command.args(["-c", "sleep 30"]);
        unsafe {
            command.pre_exec(|| {
                libc::setpgid(0, 0);
                Ok(())
            });
        }
        let child = command.spawn().expect("spawn process");
        let mut proc = InflightProc {
            child,
        };

        proc.kill();

        assert!(!proc.child.wait().expect("wait for process").success());
    }
}
