use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use std::sync::{Mutex, RwLock};

use tauri::Manager;

use super::session::DeviceSession;

/// An emulator this process started. Tracked so Terax can stop what it started
/// and clean up on exit — and, just as importantly, so it can tell those apart
/// from emulators the user launched from Android Studio, which it must leave
/// strictly alone.
pub struct LaunchedAvd {
    pub name: String,
    pub child: std::process::Child,
}

pub struct DeviceState {
    pub sessions: RwLock<HashMap<u32, DeviceSession>>,
    pub next_id: AtomicU32,
    pub jar_path: Mutex<Option<PathBuf>>,
    /// Keyed by adb serial (`emulator-<port>`).
    pub launched: Mutex<HashMap<String, LaunchedAvd>>,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
            jar_path: Mutex::new(None),
            launched: Mutex::new(HashMap::new()),
        }
    }
}

impl DeviceState {
    #[allow(dead_code)]
    pub(super) fn take(&self, id: u32) -> Option<DeviceSession> {
        self.sessions.write().unwrap().remove(&id)
    }

    pub fn kill_all(&self) {
        let drained: Vec<DeviceSession> =
            self.sessions.write().unwrap().drain().map(|(_, s)| s).collect();
        for mut s in drained {
            s.shutdown();
        }
    }

    pub fn is_managed(&self, serial: &str) -> bool {
        self.launched.lock().unwrap().contains_key(serial)
    }

    pub fn managed_serials(&self) -> Vec<String> {
        self.launched.lock().unwrap().keys().cloned().collect()
    }

    pub fn track_launched(&self, serial: String, name: String, child: std::process::Child) {
        self.launched
            .lock()
            .unwrap()
            .insert(serial, LaunchedAvd { name, child });
    }

    pub fn take_launched(&self, serial: &str) -> Option<LaunchedAvd> {
        self.launched.lock().unwrap().remove(serial)
    }

    /// Shut down only the emulators this process started. Tries the console's
    /// graceful `emu kill` first so the AVD's disk image isn't left dirty,
    /// falling back to killing the process if that fails or the binary is gone.
    pub fn kill_launched_avds(&self) {
        let drained: Vec<(String, LaunchedAvd)> =
            self.launched.lock().unwrap().drain().collect();
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
        if let Some(p) = self.jar_path.lock().unwrap().clone() {
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
        *self.jar_path.lock().unwrap() = Some(resolved.clone());
        Ok(resolved)
    }
}
