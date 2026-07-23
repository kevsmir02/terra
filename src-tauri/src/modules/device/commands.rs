use tauri::ipc::Channel;
use tauri::State;

use super::adb::{list_devices, resolve_adb_path, DeviceEntry};
use super::session::{DeviceFrame, DeviceSession};
use super::state::DeviceState;

#[tauri::command]
pub async fn device_list() -> Result<Vec<DeviceEntry>, String> {
    let adb = resolve_adb_path()?;
    tauri::async_runtime::spawn_blocking(move || list_devices(&adb))
        .await
        .map_err(|e| format!("device_list join: {e}"))?
}

/// Pick an ephemeral localhost port for the session's adb forward. Not
/// security-sensitive (binds 127.0.0.1 only per adb behavior); chosen via the
/// OS ephemeral range so two sessions don't collide.
fn ephemeral_port() -> Result<u16, String> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("ephemeral_port bind: {e}"))?
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| format!("ephemeral_port addr: {e}"))
}

#[tauri::command]
pub async fn device_open(
    app: tauri::AppHandle,
    state: State<'_, DeviceState>,
    serial: String,
    on_frame: Channel<DeviceFrame>,
) -> Result<u32, String> {
    let adb = resolve_adb_path()?;
    let jar = state.jar_path(&app)?;
    let port = ephemeral_port()?;
    let id = state.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let session = DeviceSession::spawn(id, adb, jar, serial.clone(), port, on_frame)?;
    state.sessions.write().unwrap().insert(id, session);
    Ok(id)
}

#[tauri::command]
pub fn device_close(state: State<'_, DeviceState>, handle: u32) -> Result<(), String> {
    if let Some(mut s) = state.take(handle) {
        s.shutdown();
    }
    Ok(())
}

#[tauri::command]
pub async fn device_input_tap(serial: String, x: u32, y: u32) -> Result<(), String> {
    run_adb_shell(&serial, &["input", "tap", &x.to_string(), &y.to_string()]).await
}

#[tauri::command]
pub async fn device_input_swipe(
    serial: String,
    x1: u32,
    y1: u32,
    x2: u32,
    y2: u32,
    duration_ms: u32,
) -> Result<(), String> {
    run_adb_shell(&serial, &[
        "input", "swipe",
        &x1.to_string(), &y1.to_string(),
        &x2.to_string(), &y2.to_string(),
        &duration_ms.to_string(),
    ]).await
}

#[tauri::command]
pub async fn device_input_key(serial: String, keyevent: u32) -> Result<(), String> {
    let key = keyevent.to_string();
    run_adb_shell(&serial, &["input", "keyevent", &key]).await
}

async fn run_adb_shell(serial: &str, args: &[&str]) -> Result<(), String> {
    let adb = resolve_adb_path()?;
    let serial = serial.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(adb);
        cmd.args(["-s", &serial, "shell"]);
        for a in &args {
            cmd.arg(a);
        }
        let out = cmd.output().map_err(|e| format!("adb shell: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "adb shell exited {}: {}",
                out.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("adb shell join: {e}"))?
}
