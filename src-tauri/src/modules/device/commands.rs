use tauri::ipc::Channel;
use tauri::State;

use super::adb::{launch_avd, list_avds, list_devices, resolve_adb_path, resolve_emulator_path, DeviceEntry};
use super::control::{ControlMessage, KeyAction, TouchAction};
use super::session::{DeviceFrame, DeviceSession};
use super::state::DeviceState;

#[tauri::command]
pub async fn device_list() -> Result<Vec<DeviceEntry>, String> {
    let adb = resolve_adb_path()?;
    tauri::async_runtime::spawn_blocking(move || list_devices(&adb))
        .await
        .map_err(|e| format!("device_list join: {e}"))?
}

#[tauri::command]
pub async fn device_list_avds() -> Result<Vec<String>, String> {
    let emulator = resolve_emulator_path()?;
    tauri::async_runtime::spawn_blocking(move || list_avds(&emulator))
        .await
        .map_err(|e| format!("device_list_avds join: {e}"))?
}

#[tauri::command]
pub async fn device_launch_avd(name: String) -> Result<(), String> {
    let emulator = resolve_emulator_path()?;
    tauri::async_runtime::spawn_blocking(move || launch_avd(&emulator, &name))
        .await
        .map_err(|e| format!("device_launch_avd join: {e}"))?
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
#[allow(clippy::too_many_arguments)]
pub async fn device_send_touch(
    state: State<'_, DeviceState>,
    handle: u32,
    action: u8,
    pointer_id: i64,
    x: u32,
    y: u32,
    width: u16,
    height: u16,
) -> Result<(), String> {
    device_send_touch_impl(&state, handle, action, pointer_id, x, y, width, height).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn device_send_touch_impl(
    state: &DeviceState,
    handle: u32,
    action: u8,
    pointer_id: i64,
    x: u32,
    y: u32,
    width: u16,
    height: u16,
) -> Result<(), String> {
    let act = match action {
        0 => TouchAction::Down,
        1 => TouchAction::Up,
        _ => TouchAction::Move,
    };
    let action_button = if matches!(act, TouchAction::Down | TouchAction::Up) { 1 } else { 0 };
    let buttons = if matches!(act, TouchAction::Down | TouchAction::Move) { 1 } else { 0 };
    let msg = ControlMessage::InjectTouch {
        action: act,
        pointer_id,
        x,
        y,
        width,
        height,
        pressure: 0xFFFF,
        action_button,
        buttons,
    };

    let serial = {
        let sessions = state.sessions.read().map_err(|e| e.to_string())?;
        let session = sessions.get(&handle).ok_or("session not found")?;
        if session.control_tx.try_send(msg).is_ok() {
            return Ok(());
        }
        session.serial.clone()
    };

    log::warn!("[device] control_tx channel send failed for touch event, using adb shell input fallback");
    if matches!(act, TouchAction::Down | TouchAction::Move) {
        run_adb_shell(&serial, &["input", "tap", &x.to_string(), &y.to_string()]).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn device_send_key(
    state: State<'_, DeviceState>,
    handle: u32,
    action: u8,
    keycode: u32,
    metastate: u32,
) -> Result<(), String> {
    device_send_key_impl(&state, handle, action, keycode, metastate).await
}

pub(crate) async fn device_send_key_impl(
    state: &DeviceState,
    handle: u32,
    action: u8,
    keycode: u32,
    metastate: u32,
) -> Result<(), String> {
    let act = if action == 0 { KeyAction::Down } else { KeyAction::Up };
    let msg = ControlMessage::InjectKeycode {
        action: act,
        keycode,
        repeat: 0,
        metastate,
    };

    let serial = {
        let sessions = state.sessions.read().map_err(|e| e.to_string())?;
        let session = sessions.get(&handle).ok_or("session not found")?;
        if session.control_tx.try_send(msg).is_ok() {
            return Ok(());
        }
        session.serial.clone()
    };

    log::warn!("[device] control_tx channel send failed for key event, using adb shell input fallback");
    run_adb_shell(&serial, &["input", "keyevent", &keycode.to_string()]).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn touch_succeeds_via_control_tx() {
        let state = DeviceState::default();
        let (tx, mut rx) = mpsc::channel(10);
        let session = DeviceSession {
            id: 1,
            serial: "dummy_serial".into(),
            local_port: 9999,
            adb: PathBuf::from("adb"),
            server_child: None,
            video_stream: None,
            stopping: Arc::new(AtomicBool::new(false)),
            control_tx: tx,
        };
        state.sessions.write().unwrap().insert(1, session);

        let res = device_send_touch_impl(&state, 1, 0, 0, 100, 200, 1080, 1920).await;
        assert!(res.is_ok());
        let msg = rx.try_recv().unwrap();
        if let ControlMessage::InjectTouch { x, y, action, .. } = msg {
            assert_eq!(x, 100);
            assert_eq!(y, 200);
            assert_eq!(action, TouchAction::Down);
        } else {
            panic!("expected InjectTouch");
        }
    }

    #[tokio::test]
    async fn key_succeeds_via_control_tx() {
        let state = DeviceState::default();
        let (tx, mut rx) = mpsc::channel(10);
        let session = DeviceSession {
            id: 1,
            serial: "dummy_serial".into(),
            local_port: 9999,
            adb: PathBuf::from("adb"),
            server_child: None,
            video_stream: None,
            stopping: Arc::new(AtomicBool::new(false)),
            control_tx: tx,
        };
        state.sessions.write().unwrap().insert(1, session);

        let res = device_send_key_impl(&state, 1, 0, 66, 0).await;
        assert!(res.is_ok());
        let msg = rx.try_recv().unwrap();
        if let ControlMessage::InjectKeycode { keycode, .. } = msg {
            assert_eq!(keycode, 66);
        } else {
            panic!("expected InjectKeycode");
        }
    }

    #[tokio::test]
    async fn touch_fallback_when_tx_closed() {
        let state = DeviceState::default();
        let (tx, rx) = mpsc::channel(10);
        drop(rx); // Close receiver to trigger try_send error

        let session = DeviceSession {
            id: 1,
            serial: "invalid_serial_test".into(),
            local_port: 9999,
            adb: PathBuf::from("adb"),
            server_child: None,
            video_stream: None,
            stopping: Arc::new(AtomicBool::new(false)),
            control_tx: tx,
        };
        state.sessions.write().unwrap().insert(1, session);

        // Up action when tx is closed does not call adb shell, so returns Ok(())
        let res_up = device_send_touch_impl(&state, 1, 1, 0, 100, 200, 1080, 1920).await;
        assert!(res_up.is_ok());

        // Down action when tx is closed triggers fallback (run_adb_shell), which attempts adb execution
        let res_down = device_send_touch_impl(&state, 1, 0, 0, 100, 200, 1080, 1920).await;
        // Since adb shell with invalid_serial_test fails, it should return Err containing adb error
        assert!(res_down.is_err());
    }

    #[tokio::test]
    async fn key_fallback_when_tx_closed() {
        let state = DeviceState::default();
        let (tx, rx) = mpsc::channel(10);
        drop(rx); // Close receiver to trigger try_send error

        let session = DeviceSession {
            id: 1,
            serial: "invalid_serial_test".into(),
            local_port: 9999,
            adb: PathBuf::from("adb"),
            server_child: None,
            video_stream: None,
            stopping: Arc::new(AtomicBool::new(false)),
            control_tx: tx,
        };
        state.sessions.write().unwrap().insert(1, session);

        // Key action triggers fallback (run_adb_shell), which attempts adb execution
        let res = device_send_key_impl(&state, 1, 0, 66, 0).await;
        assert!(res.is_err());
    }
}

#[tauri::command]
pub async fn device_input_tap(serial: String, x: u32, y: u32) -> Result<(), String> {
    run_adb_shell(&serial, &["input", "tap", &x.to_string(), &y.to_string()]).await
}

#[tauri::command]
pub async fn device_screen_size(serial: String) -> Result<(u32, u32), String> {
    let adb = resolve_adb_path()?;
    let output = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new(&adb)
            .args(["-s", &serial, "shell", "wm", "size"])
            .output()
            .map_err(|e| format!("adb wm size: {e}"))
    })
    .await
    .map_err(|e| format!("join: {e}"))??;

    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).into()); }
    let stdout = String::from_utf8_lossy(&output.stdout);
    // "Physical size: 1080x2400" or "Override size: 1080x2400"
    let line = stdout.lines().next().unwrap_or("");
    let size = line.rsplit(": ").next().unwrap_or("");
    let (w, h) = size.split_once('x').ok_or_else(|| format!("parse: {line}"))?;
    Ok((w.trim().parse().map_err(|e| format!("w: {e}"))?,
        h.trim().parse().map_err(|e| format!("h: {e}"))?))
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
