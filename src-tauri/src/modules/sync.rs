//! Poison-tolerant lock helpers.
//!
//! A panic while a lock is held poisons it for the rest of the process, so a
//! single bad frame would otherwise turn into a permanently dead subsystem: no
//! further PTY spawns, no fs authorization, no device sessions, until restart.
//!
//! Every value behind these locks is plain data (maps of sessions, a set of
//! roots, a byte buffer). A writer that panics mid-update can leave it stale,
//! never torn or unsound, so taking the guard anyway is strictly better than
//! propagating one panic to every later caller.

use std::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub trait MutexExt<T> {
    /// Locks, recovering the guard if a previous holder panicked.
    fn lock_or_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> MutexExt<T> for Mutex<T> {
    fn lock_or_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub trait RwLockExt<T> {
    /// Read-locks, recovering the guard if a previous writer panicked.
    fn read_or_recover(&self) -> RwLockReadGuard<'_, T>;
    /// Write-locks, recovering the guard if a previous writer panicked.
    fn write_or_recover(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T> RwLockExt<T> for RwLock<T> {
    fn read_or_recover(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_or_recover(&self) -> RwLockWriteGuard<'_, T> {
        self.write().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn mutex_stays_usable_after_a_holder_panics() {
        let m = Arc::new(Mutex::new(vec![1, 2, 3]));
        let clone = Arc::clone(&m);
        let _ = std::thread::spawn(move || {
            let _guard = clone.lock().unwrap();
            panic!("poison it");
        })
        .join();

        assert!(m.lock().is_err(), "precondition: the mutex is poisoned");
        assert_eq!(*m.lock_or_recover(), vec![1, 2, 3]);
    }

    #[test]
    fn rwlock_stays_usable_after_a_writer_panics() {
        let l = Arc::new(RwLock::new(String::from("state")));
        let clone = Arc::clone(&l);
        let _ = std::thread::spawn(move || {
            let _guard = clone.write().unwrap();
            panic!("poison it");
        })
        .join();

        assert!(l.read().is_err(), "precondition: the lock is poisoned");
        assert_eq!(&*l.read_or_recover(), "state");
        l.write_or_recover().push_str(" again");
        assert_eq!(&*l.read_or_recover(), "state again");
    }
}
