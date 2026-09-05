use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use tauri::Manager;

use super::session::DeviceSession;
use crate::modules::sync::{MutexExt, RwLockExt};

/// An emulator this process started. Tracked so Terra can stop what it started
/// and clean up on exit, and, just as importantly, so it can tell those apart
/// from emulators the user launched from Android Studio, which it must leave
/// strictly alone.
pub struct LaunchedAvd {
    pub name: String,
    pub child: std::process::Child,
}

/// Exclusive claim on one serial for the lifetime of a mirror session. Each
/// session gets its own scid and abstract socket, so two live sessions on one
/// serial no longer collide on the wire, but they would still fight over the
/// same touch/key input and adb forwards, so only one session per serial is
/// allowed at a time.
pub struct SerialReservation {
    open: Arc<Mutex<HashSet<String>>>,
    serial: String,
    released: AtomicBool,
}

impl SerialReservation {
    /// Release-once: every session-end path may call this without freeing a
    /// serial that a newer session has since reserved.
    pub fn release(&self) {
        if !self.released.swap(true, Ordering::AcqRel) {
            self.open.lock_or_recover().remove(&self.serial);
        }
    }
}

impl Drop for SerialReservation {
    fn drop(&mut self) {
        self.release();
    }
}

pub struct DeviceState {
    pub sessions: RwLock<HashMap<u32, DeviceSession>>,
    pub next_handle: AtomicU32,
    pub jar_path: Mutex<Option<PathBuf>>,
    /// Keyed by adb serial (`emulator-<port>`).
    pub launched: Mutex<HashMap<String, LaunchedAvd>>,
    open_serials: Arc<Mutex<HashSet<String>>>,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_handle: AtomicU32::new(1),
            jar_path: Mutex::new(None),
            launched: Mutex::new(HashMap::new()),
            open_serials: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

impl DeviceState {
    pub(super) fn take(&self, handle: u32) -> Option<DeviceSession> {
        self.sessions.write_or_recover().remove(&handle)
    }

    pub fn reserve_serial(&self, serial: &str) -> Result<Arc<SerialReservation>, String> {
        let mut open = self.open_serials.lock_or_recover();
        if !open.insert(serial.to_string()) {
            return Err(format!("device {serial} is already open"));
        }
        Ok(Arc::new(SerialReservation {
            open: Arc::clone(&self.open_serials),
            serial: serial.to_string(),
            released: AtomicBool::new(false),
        }))
    }

    pub fn kill_all(&self) {
        let drained: Vec<DeviceSession> =
            self.sessions.write_or_recover().drain().map(|(_, s)| s).collect();
        for mut s in drained {
            s.shutdown();
        }
    }

    pub fn is_managed(&self, serial: &str) -> bool {
        self.launched.lock_or_recover().contains_key(serial)
    }

    pub fn managed_serials(&self) -> Vec<String> {
        self.launched.lock_or_recover().keys().cloned().collect()
    }

    pub fn track_launched(&self, serial: String, name: String, child: std::process::Child) {
        self.launched
            .lock_or_recover()
            .insert(serial, LaunchedAvd { name, child });
    }

    pub fn take_launched(&self, serial: &str) -> Option<LaunchedAvd> {
        self.launched.lock_or_recover().remove(serial)
    }

    /// Shut down only the emulators this process started. Tries the console's
    /// graceful `emu kill` first so the AVD's disk image isn't left dirty,
    /// falling back to killing the process if that fails or the binary is gone.
    pub fn kill_launched_avds(&self) {
        let drained: Vec<(String, LaunchedAvd)> =
            self.launched.lock_or_recover().drain().collect();
        if drained.is_empty() {
            return;
        }
        let adb = super::adb::resolve_adb_path().ok();
        for (serial, mut avd) in drained {
            let stopped = adb
                .as_ref()
                .map(|adb| super::adb::emu_kill(adb, &serial).is_ok())
                .unwrap_or(false);
            if !stopped {
                log::warn!("[device] emu kill failed for {serial}; killing process");
                let _ = avd.child.kill();
            }
            let _ = avd.child.wait();
        }
    }

    /// Resolve the bundled scrcpy-server JAR absolute path on first use, then
    /// cache. Returns a clone of the cached path on subsequent calls.
    pub fn jar_path(&self, app: &tauri::AppHandle) -> Result<PathBuf, String> {
        if let Some(p) = self.jar_path.lock_or_recover().clone() {
            return Ok(p);
        }
        let fname = format!(
            "resources/scrcpy-server-{}.jar",
            super::scrcpy_server_version::SCRCPY_SERVER_VERSION
        );
        let resolved = app
            .path()
            .resolve(&fname, tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("resolving bundled scrcpy-server JAR: {e}"))?;
        *self.jar_path.lock_or_recover() = Some(resolved.clone());
        Ok(resolved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn idle_child() -> std::process::Child {
        let mut cmd = if cfg!(windows) {
            let mut c = std::process::Command::new("cmd.exe");
            c.args(["/C", "exit 0"]);
            c
        } else {
            std::process::Command::new("true")
        };
        cmd.spawn().expect("spawn idle child")
    }

    #[test]
    fn reserve_serial_twice_fails_with_already_open() {
        let state = DeviceState::default();
        let _held = state.reserve_serial("emulator-5554").expect("first reservation");
        let err = state.reserve_serial("emulator-5554").err().expect("second reservation must fail");
        assert_eq!(err, "device emulator-5554 is already open");
        assert!(state.reserve_serial("emulator-5556").is_ok(), "other serials stay free");
    }

    #[test]
    fn release_then_reserve_succeeds() {
        let state = DeviceState::default();
        let held = state.reserve_serial("emulator-5554").unwrap();
        held.release();
        assert!(state.reserve_serial("emulator-5554").is_ok());
    }

    #[test]
    fn dropping_reservation_releases_it() {
        let state = DeviceState::default();
        drop(state.reserve_serial("emulator-5554").unwrap());
        assert!(state.reserve_serial("emulator-5554").is_ok());
    }

    #[test]
    fn stale_release_does_not_free_a_newer_reservation() {
        let state = DeviceState::default();
        let old = state.reserve_serial("emulator-5554").unwrap();
        old.release();
        let _newer = state.reserve_serial("emulator-5554").unwrap();
        old.release();
        drop(old);
        assert!(state.reserve_serial("emulator-5554").is_err(), "the newer session still owns the serial");
    }

    #[test]
    fn track_launched_survives_a_poisoned_lock() {
        let state = Arc::new(DeviceState::default());
        let poisoner = Arc::clone(&state);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.launched.lock().unwrap();
            panic!("poison it");
        })
        .join();
        assert!(state.launched.lock().is_err(), "precondition: the mutex is poisoned");

        state.track_launched("emulator-5554".into(), "Pixel_8".into(), idle_child());

        assert!(state.is_managed("emulator-5554"));
        let mut avd = state.take_launched("emulator-5554").expect("entry present");
        let _ = avd.child.wait();
    }
}
