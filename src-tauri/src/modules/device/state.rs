use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use std::sync::{Mutex, RwLock};

use tauri::Manager;

use super::session::DeviceSession;

pub struct DeviceState {
    pub sessions: RwLock<HashMap<u32, DeviceSession>>,
    pub next_id: AtomicU32,
    pub jar_path: Mutex<Option<PathBuf>>,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
            jar_path: Mutex::new(None),
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
