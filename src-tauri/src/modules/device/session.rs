use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, ChildStdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;

use super::remux::{drain_complete_nals, split_nal_units, Fmp4Builder};

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
    /// takes the stdout pipe for the read loop, and starts a blocking-IO thread
    /// that reads Annex-B NALs, builds the fMP4 init segment from the first
    /// SPS+PPS, and emits `DeviceFrame` events on `channel`.
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
        let child = super::server::spawn_server(&adb, &jar, &serial, local_port)?;
        let stopping = Arc::new(AtomicBool::new(false));
        let stop_clone = stopping.clone();
        let _handle = tauri::async_runtime::spawn_blocking(move || {
            run_read_loop(local_port, channel, stop_clone);
        });
        Ok(Self {
            id,
            serial,
            local_port,
            server_child: Some(child),
            video_stream: None,
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

/// Read the raw Annex-B H.264 stream off `TcpStream(127.0.0.1:local_port)`, split
/// it into NAL units, bootstrap an `Fmp4Builder` from the first SPS+PPS (deriving the
/// `avc1.*` codec string), then emit every slice NAL as an fMP4 media fragment on
/// `channel`. `Channel::send` is synchronous (it just queues for the webview),
/// so no async runtime is needed in this thread.
fn run_read_loop(
    local_port: u16,
    channel: Channel<DeviceFrame>,
    stopping: Arc<AtomicBool>,
) {
    let mut stream = None;
    for _ in 0..30 {
        if stopping.load(Ordering::Relaxed) {
            return;
        }
        if let Ok(s) = std::net::TcpStream::connect(("127.0.0.1", local_port)) {
            stream = Some(s);
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    let mut stream = match stream {
        Some(s) => s,
        None => return,
    };

    let mut buf: Vec<u8> = Vec::new();
    let mut read_buf = [0u8; 65536];

    let mut builder: Option<Fmp4Builder> = None; // Some once SPS+PPS seen.
    let mut sps: Option<Vec<u8>> = None;
    let mut pps: Option<Vec<u8>> = None;
    let mut pending_slices: Vec<Vec<u8>> = Vec::new(); // slices that arrived before init.

    let emit_init = |builder: &Fmp4Builder, channel: &Channel<DeviceFrame>| {
        let cs = builder.codec_string();
        let mut frame = Vec::with_capacity(4 + cs.len() + builder.init_segment().len());
        frame.extend_from_slice(&(cs.len() as u32).to_be_bytes());
        frame.extend_from_slice(cs.as_bytes());
        frame.extend_from_slice(builder.init_segment());
        let _ = channel.send(DeviceFrame { kind: 0, bytes: frame });
    };
    let emit_media = |builder: &mut Fmp4Builder, channel: &Channel<DeviceFrame>, nal: &[u8]| {
        let frag = builder.append_nal(nal);
        let _ = channel.send(DeviceFrame { kind: 1, bytes: frag });
    };

    loop {
        if stopping.load(Ordering::Relaxed) {
            break;
        }
        let n = match stream.read(&mut read_buf) {
            Ok(0) => 0, // EOF: flush below
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        };

        if n == 0 {
            // End of stream: everything currently in `buf` is complete. Flush it.
            for nal in split_nal_units(&buf) {
                if nal.is_empty() {
                    continue;
                }
                let t = nal[0] & 0x1F;
                if let Some(b) = builder.as_mut() {
                    if t == 7 || t == 8 {
                        // Repeated SPS/PPS in-band: init already sent; ignore.
                        continue;
                    }
                    emit_media(b, &channel, &nal);
                }
            }
            break;
        }

        buf.extend_from_slice(&read_buf[..n]);

        // NAL types: 7 = SPS, 8 = PPS, 5 = IDR, 1 = non-IDR slice, 2 = partition A.
        for nal in drain_complete_nals(&mut buf) {
            if nal.is_empty() {
                continue;
            }
            let t = nal[0] & 0x1F;
            match t {
                7 => sps = Some(nal),
                8 => pps = Some(nal),
                _ => {
                    if let Some(b) = builder.as_mut() {
                        emit_media(b, &channel, &nal);
                    } else {
                        pending_slices.push(nal);
                    }
                    continue;
                }
            }
            // After storing SPS or PPS, try to bootstrap the init segment once
            // both are available, then flush any pending slices.
            if builder.is_none() {
                if let (Some(s), Some(p)) = (sps.as_ref(), pps.as_ref()) {
                    let codec = format!("avc1.{:02x}{:02x}{:02x}", s[1], s[2], s[3]);
                    let mut b = Fmp4Builder::new(codec);
                    b.set_init_segment(s, p);
                    emit_init(&b, &channel);
                    for ps in pending_slices.drain(..) {
                        emit_media(&mut b, &channel, &ps);
                    }
                    builder = Some(b);
                }
            }
        }
    }
}