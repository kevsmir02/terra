use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::modules::sync::MutexExt;

#[derive(Default)]
pub struct ServicesState {
    inflight: Mutex<HashMap<u64, Child>>,
    next: AtomicU64,
}

impl ServicesState {
    pub fn register(&self, child: Child) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.inflight.lock_or_recover().insert(id, child);
        id
    }

    pub fn finish(&self, id: u64) -> Option<Child> {
        self.inflight.lock_or_recover().remove(&id)
    }

    /// Containers are deliberately left running. Only the compose CLI
    /// invocations Terra started are killed.
    pub fn kill_all(&self) {
        for (_, mut child) in self.inflight.lock_or_recover().drain() {
            let _ = child.kill();
        }
    }
}
