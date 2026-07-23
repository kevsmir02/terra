use std::path::PathBuf;
use std::process::{Child, ChildStdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;

#[derive(serde::Serialize, Clone)]
pub struct DeviceFrame {
    /// 0 = init segment (ftyp+moov), 1 = media fragment (moof+mdat).
    pub kind: u8,
    /// Raw fMP4 bytes — the webview appends these to a `SourceBuffer`.
    pub bytes: Vec<u8>,
}

pub struct DeviceSession {
    pub id: u32,
    pub serial: String,
    pub local_port: u16,
    /// Owns the `adb shell app_process ...` process. Dropping kills it.
    pub server_child: Option<Child>,
    /// The stdout pipe of the adb process; this is the raw Annex-B H.264 stream.
    pub video_stream: Option<ChildStdout>,
    pub stopping: Arc<AtomicBool>,
}

impl DeviceSession {
    /// Spawn a session: pushes the JAR, forwards the port, starts the server,
    /// takes the stdout pipe for the read loop, and (in Task 5 stage 2) starts
    /// a blocking-IO thread that reads Annex-B NALs, builds the fMP4 init
    /// segment from the first SPS+PPS, and emits `DeviceFrame` events on `channel`.
    ///
    /// `local_port` is chosen by the caller from the OS ephemeral range.
    pub fn spawn(
        id: u32,
        adb: PathBuf,
        jar: PathBuf,
        serial: String,
        local_port: u16,
        channel: Channel<DeviceFrame>,
    ) -> Result<Self, String> {
        let mut child = super::server::spawn_server(&adb, &jar, &serial, local_port)?;
        let stdout = child.stdout.take();
        let stopping = Arc::new(AtomicBool::new(false));
        let stop_clone = stopping.clone();
        let _handle = tauri::async_runtime::spawn_blocking(move || {
            run_read_loop(stdout, channel, stop_clone);
        });
        Ok(Self {
            id,
            serial,
            local_port,
            server_child: Some(child),
            video_stream: None, // moved into the read loop thread
            stopping,
        })
    }

    pub fn shutdown(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
        if let Some(mut child) = self.server_child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for DeviceSession {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// The actual read loop is filled in Task 5 stage 2 because it depends on the
/// `Fmp4Builder` init-segment computation, which requires a captured Annex-B
/// fixture to do correctly (see Task 4 step 5 note).
fn run_read_loop(
    _stdout: Option<std::process::ChildStdout>,
    _channel: Channel<DeviceFrame>,
    _stopping: Arc<AtomicBool>,
) {
    // v1 stage 2: read Annex-B bytes from _stdout, split_nal_units, bootstrap
    // Fmp4Builder from first SPS+PPS NALs (computing the avc1 codec string),
    // then for every IDR/P-frame NAL call `builder.append_nal(nal)` and emit
    // `DeviceFrame { kind: 1, bytes }` via `_channel.send(...)`. The init
    // segment is emitted once as `DeviceFrame { kind: 0, bytes: builder.init_segment().to_vec() }`
    // before the first media fragment.
}
