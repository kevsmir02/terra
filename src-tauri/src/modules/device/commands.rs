use std::time::{Duration, Instant};

use tauri::ipc::Channel;
use tauri::{Emitter, Manager, State};

use super::adb::{
    boot_completed, create_avd, emu_kill, free_emulator_port, host_has_display, launch_avd,
    list_avd_names, list_devices, list_system_images, log_tail, resolve_adb_path,
    resolve_avdmanager_path, resolve_emulator_path, running_avds, AvdEntry, DeviceEntry,
    SystemImage, GPU_FALLBACK,
};
use super::control::{ControlMessage, KeyAction, TouchAction};
use super::session::{DeviceFrame, DeviceSession};
use super::state::DeviceState;

/// A cold boot on a slow machine genuinely can take this long; a quick-boot
/// from snapshot is usually a few seconds.
const BOOT_TIMEOUT: Duration = Duration::from_secs(240);
const BOOT_POLL_INTERVAL: Duration = Duration::from_millis(750);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvdBootEvent {
    pub name: String,
    pub serial: String,
    /// `starting` | `waiting-for-device` | `booting` | `ready` | `failed`
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[tauri::command]
pub async fn device_list() -> Result<Vec<DeviceEntry>, String> {
    let adb = resolve_adb_path()?;
    tauri::async_runtime::spawn_blocking(move || list_devices(&adb))
        .await
        .map_err(|e| format!("device_list join: {e}"))?
}

/// Lists every AVD, annotated with the serial of its running instance (so the
/// UI can attach instead of failing on a relaunch) and whether Terax owns it.
#[tauri::command]
pub async fn device_list_avds(state: State<'_, DeviceState>) -> Result<Vec<AvdEntry>, String> {
    let emulator = resolve_emulator_path()?;
    // adb may legitimately be absent while the emulator package is installed;
    // fall back to reporting every AVD as not-running rather than erroring.
    let adb = resolve_adb_path().ok();
    let entries = tauri::async_runtime::spawn_blocking(move || {
        let names = list_avd_names(&emulator)?;
        let running = match &adb {
            Some(adb) => list_devices(adb)
                .map(|devices| running_avds(adb, &devices))
                .unwrap_or_default(),
            None => Default::default(),
        };
        Ok::<_, String>(
            names
                .into_iter()
                .map(|name| {
                    let serial = running.get(&name).cloned();
                    AvdEntry {
                        name,
                        serial,
                        managed: false,
                    }
                })
                .collect::<Vec<_>>(),
        )
    })
    .await
    .map_err(|e| format!("device_list_avds join: {e}"))??;

    Ok(entries
        .into_iter()
        .map(|mut e| {
            e.managed = e.serial.as_deref().map(|s| state.is_managed(s)).unwrap_or(false);
            e
        })
        .collect())
}

#[tauri::command]
pub async fn device_list_system_images() -> Result<Vec<SystemImage>, String> {
    tauri::async_runtime::spawn_blocking(list_system_images)
        .await
        .map_err(|e| format!("device_list_system_images join: {e}"))
}

#[tauri::command]
pub async fn device_create_avd(name: String, package: String) -> Result<(), String> {
    let avdmanager = resolve_avdmanager_path()?;
    tauri::async_runtime::spawn_blocking(move || create_avd(&avdmanager, &name, &package))
        .await
        .map_err(|e| format!("device_create_avd join: {e}"))?
}

/// Starts an AVD headless and returns its serial immediately; boot progress
/// arrives as `device:avd-boot` events so the caller never has to guess how
/// long a cold boot takes.
#[tauri::command]
pub async fn device_launch_avd(
    app: tauri::AppHandle,
    state: State<'_, DeviceState>,
    name: String,
    gpu: Option<String>,
) -> Result<String, String> {
    let emulator = resolve_emulator_path()?;
    let adb = resolve_adb_path()?;

    let devices = list_devices(&adb).unwrap_or_default();
    let port = free_emulator_port(&devices)?;
    let log_path = std::env::temp_dir().join(format!("terax-emulator-{port}.log"));
    let launched = launch_avd(&emulator, &name, port, gpu.as_deref(), log_path.clone())?;
    let serial = launched.serial.clone();
    state.track_launched(serial.clone(), name.clone(), launched.child);

    let app_for_thread = app.clone();
    let serial_for_thread = serial.clone();
    std::thread::Builder::new()
        .name("terax-avd-boot".into())
        .spawn(move || {
            await_boot(
                app_for_thread,
                adb,
                emulator,
                name,
                serial_for_thread,
                port,
                gpu,
                log_path,
            );
        })
        .map_err(|e| format!("spawn boot watcher: {e}"))?;

    Ok(serial)
}

fn emit_boot(app: &tauri::AppHandle, name: &str, serial: &str, phase: &str, message: Option<String>) {
    let _ = app.emit(
        "device:avd-boot",
        AvdBootEvent {
            name: name.to_string(),
            serial: serial.to_string(),
            phase: phase.to_string(),
            message,
        },
    );
}

/// Polls until Android reports `sys.boot_completed`.
///
/// If the emulator dies first, retrying on software rendering is only correct
/// when the host genuinely cannot provide GL — i.e. there is no display server.
/// On a desktop the AVD's own renderer is right and forcing a different one is
/// what breaks it, so there we fail fast and report the emulator's own log
/// rather than crashing a second time.
#[allow(clippy::too_many_arguments)]
fn await_boot(
    app: tauri::AppHandle,
    adb: std::path::PathBuf,
    emulator: std::path::PathBuf,
    name: String,
    serial: String,
    port: u16,
    gpu: Option<String>,
    log_path: std::path::PathBuf,
) {
    emit_boot(&app, &name, &serial, "starting", None);
    let deadline = Instant::now() + BOOT_TIMEOUT;
    // Only meaningful on a headless host, and pointless if a mode was pinned.
    let mut may_retry_on_software_gpu =
        gpu.is_none() && !host_has_display() && GPU_FALLBACK != gpu.as_deref().unwrap_or("");
    let mut announced_booting = false;

    while Instant::now() < deadline {
        // A dead child means the emulator bailed out; nothing will ever boot.
        let exited = {
            let state = app.state::<DeviceState>();
            let mut guard = state.launched.lock().unwrap();
            match guard.get_mut(&serial) {
                Some(avd) => avd.child.try_wait().ok().flatten().is_some(),
                // Stopped from under us (device_stop_avd, or app exit).
                None => return,
            }
        };

        if exited {
            let state = app.state::<DeviceState>();
            state.take_launched(&serial);
            let reason = log_tail(&log_path, 3);

            if !may_retry_on_software_gpu {
                let detail = match reason {
                    Some(r) => format!("emulator exited before Android finished booting — {r}"),
                    None => "emulator exited before Android finished booting".to_string(),
                };
                log::warn!("[device] {serial}: {detail}");
                emit_boot(&app, &name, &serial, "failed", Some(detail));
                return;
            }

            may_retry_on_software_gpu = false;
            log::warn!(
                "[device] emulator {serial} exited with no display present; retrying on {GPU_FALLBACK}"
            );
            emit_boot(
                &app,
                &name,
                &serial,
                "starting",
                Some(format!("no display detected; retrying with {GPU_FALLBACK}")),
            );
            match launch_avd(
                &emulator,
                &name,
                port,
                Some(GPU_FALLBACK),
                log_path.clone(),
            ) {
                Ok(relaunched) => {
                    state.track_launched(serial.clone(), name.clone(), relaunched.child);
                }
                Err(e) => {
                    emit_boot(&app, &name, &serial, "failed", Some(e));
                    return;
                }
            }
            std::thread::sleep(BOOT_POLL_INTERVAL);
            continue;
        }

        let visible = list_devices(&adb)
            .map(|d| d.iter().any(|e| e.serial == serial && e.state == "device"))
            .unwrap_or(false);
        if visible {
            if !announced_booting {
                announced_booting = true;
                emit_boot(&app, &name, &serial, "booting", None);
            }
            if boot_completed(&adb, &serial) {
                emit_boot(&app, &name, &serial, "ready", None);
                return;
            }
        } else if !announced_booting {
            emit_boot(&app, &name, &serial, "waiting-for-device", None);
        }
        std::thread::sleep(BOOT_POLL_INTERVAL);
    }

    emit_boot(
        &app,
        &name,
        &serial,
        "failed",
        Some(format!(
            "timed out after {}s waiting for Android to finish booting",
            BOOT_TIMEOUT.as_secs()
        )),
    );
}

/// Only stops emulators Terax started. One launched from Android Studio is the
/// user's to manage, and killing it would be hostile.
#[tauri::command]
pub async fn device_stop_avd(state: State<'_, DeviceState>, serial: String) -> Result<(), String> {
    let Some(mut avd) = state.take_launched(&serial) else {
        return Err(format!("{serial} was not launched by Terax"));
    };
    let adb = resolve_adb_path()?;
    tauri::async_runtime::spawn_blocking(move || {
        if emu_kill(&adb, &serial).is_err() {
            log::warn!("[device] emu kill failed for {serial}; killing process");
            let _ = avd.child.kill();
        }
        let _ = avd.child.wait();
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| format!("device_stop_avd join: {e}"))?
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
        // x/y arrive in the encoded-video space scrcpy requires, but
        // `input tap` addresses the physical panel — scale across or the tap
        // lands short on any device where max_size downscaled the stream.
        let (tx, ty) = to_physical(&serial, x, y, width, height).await;
        run_adb_shell(&serial, &["input", "tap", &tx.to_string(), &ty.to_string()]).await?;
    }
    Ok(())
}

/// Convert a point from the encoded-video space into physical display pixels.
/// Falls back to the input unchanged when the physical size can't be read.
async fn to_physical(serial: &str, x: u32, y: u32, width: u16, height: u16) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (x, y);
    }
    match device_screen_size(serial.to_string()).await {
        Ok((pw, ph)) => (
            (x as u64 * pw as u64 / width as u64) as u32,
            (y as u64 * ph as u64 / height as u64) as u32,
        ),
        Err(e) => {
            log::warn!("[device] physical size unavailable for fallback tap: {e}");
            (x, y)
        }
    }
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

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn device_send_scroll(
    state: State<'_, DeviceState>,
    handle: u32,
    x: u32,
    y: u32,
    width: u16,
    height: u16,
    h: i16,
    v: i16,
) -> Result<(), String> {
    device_send_scroll_impl(&state, handle, x, y, width, height, h, v).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn device_send_scroll_impl(
    state: &DeviceState,
    handle: u32,
    x: u32,
    y: u32,
    width: u16,
    height: u16,
    h: i16,
    v: i16,
) -> Result<(), String> {
    let msg = ControlMessage::InjectScroll {
        x,
        y,
        width,
        height,
        h,
        v,
        buttons: 0,
    };

    {
        let sessions = state.sessions.read().map_err(|e| e.to_string())?;
        let session = sessions.get(&handle).ok_or("session not found")?;
        if session.control_tx.try_send(msg).is_ok() {
            return Ok(());
        }
    }

    // Unlike touch and key there is no faithful `adb shell input` equivalent
    // for a wheel tick; approximating it with a swipe would fire unintended
    // gestures, so a dropped scroll is preferable to a wrong one.
    log::warn!("[device] control_tx channel send failed for scroll event; dropping");
    Ok(())
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
    async fn scroll_succeeds_via_control_tx() {
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

        let res = device_send_scroll_impl(&state, 1, 100, 200, 1080, 1920, 0, -3).await;
        assert!(res.is_ok());
        let msg = rx.try_recv().unwrap();
        if let ControlMessage::InjectScroll { x, y, v, .. } = msg {
            assert_eq!(x, 100);
            assert_eq!(y, 200);
            assert_eq!(v, -3);
        } else {
            panic!("expected InjectScroll");
        }
    }

    // No faithful `adb shell input` equivalent exists, so a dead channel must
    // drop the wheel tick rather than surface an error or fake a swipe.
    #[tokio::test]
    async fn scroll_drops_when_tx_closed() {
        let state = DeviceState::default();
        let (tx, rx) = mpsc::channel(10);
        drop(rx);

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

        let res = device_send_scroll_impl(&state, 1, 100, 200, 1080, 1920, 0, -3).await;
        assert!(res.is_ok());
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
