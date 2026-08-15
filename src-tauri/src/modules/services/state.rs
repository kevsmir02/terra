use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::modules::sync::MutexExt;

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
}

impl ServicesState {
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

#[cfg(all(test, unix))]
mod tests {
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
