use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, ChildStdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;
use tokio::sync::mpsc;

use super::control::{serialize_control_message, ControlMessage};
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
    pub adb: PathBuf,
    /// Owns the `adb shell app_process ...` process. Dropping kills it.
    pub server_child: Option<Child>,
    /// The stdout pipe of the adb process; this is the raw Annex-B H.264 stream.
    pub video_stream: Option<ChildStdout>,
    pub stopping: Arc<AtomicBool>,
    pub control_tx: mpsc::Sender<ControlMessage>,
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

        let (tx, mut rx) = mpsc::channel::<ControlMessage>(128);
        let control_port = local_port + 1;
        let stop_control = stopping.clone();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();

        tauri::async_runtime::spawn_blocking(move || {
            run_read_loop(local_port, channel, stop_clone, Some(ready_tx));
        });

        tauri::async_runtime::spawn_blocking(move || {
            run_control_loop(control_port, &mut rx, stop_control, ready_rx);
        });

        Ok(Self {
            id,
            serial,
            local_port,
            adb,
            server_child: Some(child),
            video_stream: None,
            stopping,
            control_tx: tx,
        })
    }

    pub fn shutdown(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
        if let Some(mut child) = self.server_child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::process::Command::new(&self.adb)
            .args(["-s", &self.serial, "forward", "--remove", &format!("tcp:{}", self.local_port)])
            .output();
        let _ = std::process::Command::new(&self.adb)
            .args(["-s", &self.serial, "forward", "--remove", &format!("tcp:{}", self.local_port + 1)])
            .output();
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
    mut ready_tx: Option<tokio::sync::oneshot::Sender<()>>,
) {
    log::info!("[device] read_loop start: connecting to TCP 127.0.0.1:{local_port}");
    // adb forward maps the local TCP port IMMEDIATELY (before the scrcpy server
    // has even bound its abstract socket), so `connect()` succeeds right away even
    // when the remote side isn't ready: the first `read()` then returns 0 (EOF)
    // because adb closed the pipe. We must retry the full connect+probe cycle,
    // not just connect.
    let mut stream: Option<std::net::TcpStream> = None;
    let mut probe = [0u8; 1];
    for attempt in 1..=60 {
        if stopping.load(Ordering::Relaxed) {
            log::info!("[device] read_loop: stopping before connect");
            return;
        }
        match std::net::TcpStream::connect(("127.0.0.1", local_port)) {
            Ok(s) => {
                // \/ Wait up to 100ms for the first byte; if nothing arrives the
                // remote side isn't alive yet (scrcpy hasn't accept()-ed or the
                // MediaCodec hasn't produced its startup SPS/PPS).
                s.set_read_timeout(Some(std::time::Duration::from_millis(100)))
                    .ok();
                match s.peek(&mut probe) {
                    Ok(0) => {
                        // adb accepted our local connection but the remote
                        // abstract socket isn't ready — close and retry.
                        log::debug!("[device] read_loop attempt {attempt}/60: port open, remote not ready (peek=0)");
                        drop(s);
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        continue;
                    }
                    Ok(_) | Err(_) => {
                        // Data arrived or peek() isn't supported on this platform;
                        // either way we'll find out in the read loop. Switch back
                        // to blocking reads.
                        s.set_read_timeout(None).ok();
                        log::info!("[device] read_loop: TCP connected + alive on attempt {attempt}/60");
                        if let Some(tx) = ready_tx.take() {
                            let _ = tx.send(());
                        }
                        stream = Some(s);
                        break;
                    }
                }
            }
            Err(e) => {
                log::debug!("[device] read_loop attempt {attempt}/60: connect failed: {e}");
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }

    let mut stream = match stream {
        Some(s) => s,
        None => {
            log::error!(
                "[device] read_loop: TCP connect FAILED after 60×~200ms (~12s); \
                 scrcpy server never became ready on 127.0.0.1:{local_port} — \
                 check the 'scrcpy-server stderr' lines above"
            );
            return;
        }
    };

    let mut buf: Vec<u8> = Vec::new();
    let mut read_buf = [0u8; 65536];

    let mut builder: Option<Fmp4Builder> = None; // Some once SPS+PPS seen.
    let mut sps: Option<Vec<u8>> = None;
    let mut pps: Option<Vec<u8>> = None;
    let mut pending_slices: Vec<Vec<u8>> = Vec::new(); // slices that arrived before init.

    // DIAGNOSTIC counters per run_loop lifetime.
    let mut total_bytes: u64 = 0;
    let mut reads: u64 = 0;
    let mut nals_sps: u32 = 0;
    let mut nals_pps: u32 = 0;
    let mut nals_idr: u32 = 0;
    let mut nals_nonidr: u32 = 0;
    let mut nals_other: u32 = 0;
    let mut media_sent: u64 = 0;

    let emit_init = |builder: &Fmp4Builder, channel: &Channel<DeviceFrame>| {
        let cs = builder.codec_string();
        let mut frame = Vec::with_capacity(4 + cs.len() + builder.init_segment().len());
        frame.extend_from_slice(&(cs.len() as u32).to_be_bytes());
        frame.extend_from_slice(cs.as_bytes());
        frame.extend_from_slice(builder.init_segment());
        let frame_len = frame.len();
        let _ = channel.send(DeviceFrame { kind: 0, bytes: frame });
        log::info!("[device] read_loop: EMIT INIT segment codec={cs} bytes={frame_len}");
    };
    let emit_media = |builder: &mut Fmp4Builder, channel: &Channel<DeviceFrame>, nal: &[u8], media_sent: &mut u64| {
        let frag = builder.append_nal(nal);
        let _ = channel.send(DeviceFrame { kind: 1, bytes: frag });
        *media_sent += 1;
    };

    loop {
        if stopping.load(Ordering::Relaxed) {
            log::info!("[device] read_loop: stopping (reads={reads} bytes={total_bytes} \
                       sps={nals_sps} pps={nals_pps} idr={nals_idr} nonidr={nals_nonidr} \
                       other={nals_other} media_sent={media_sent})");
            break;
        }
        let n = match stream.read(&mut read_buf) {
            Ok(0) => 0, // EOF: flush below
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => {
                log::warn!("[device] read_loop: stream read error after {total_bytes} bytes: {e}");
                break;
            }
        };
        reads += 1;
        total_bytes += n as u64;

        if n == 0 {
            // End of stream: everything currently in `buf` is complete. Flush it.
            log::info!(
                "[device] read_loop: stream EOF at {total_bytes} bytes \
                 (sps={nals_sps} pps={nals_pps} idr={nals_idr} nonidr={nals_nonidr} \
                 other={nals_other}) — flushing trailing NALs"
            );
            for nal in split_nal_units(&buf) {
                if nal.is_empty() {
                    continue;
                }
                let t = nal[0] & 0x1F;
                if let Some(b) = builder.as_mut() {
                    if t == 7 || t == 8 {
                        continue;
                    }
                    emit_media(b, &channel, &nal, &mut media_sent);
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
                7 => { nals_sps += 1; sps = Some(nal); }
                8 => { nals_pps += 1; pps = Some(nal); }
                5 => { nals_idr += 1; emit_or_pending(&mut builder, &channel, &nal, &mut pending_slices, &mut media_sent); continue; }
                1 => { nals_nonidr += 1; emit_or_pending(&mut builder, &channel, &nal, &mut pending_slices, &mut media_sent); continue; }
                _ => { nals_other += 1; emit_or_pending(&mut builder, &channel, &nal, &mut pending_slices, &mut media_sent); continue; }
            }
            // After storing SPS or PPS, try to bootstrap the init segment once
            // both are available, then flush any pending slices.
            if builder.is_none() {
                if let (Some(s), Some(p)) = (sps.as_ref(), pps.as_ref()) {
                    let codec = format!("avc1.{:02x}{:02x}{:02x}", s[1], s[2], s[3]);
                    log::info!(
                        "[device] read_loop: bootstrap ready — codec={codec} \
                         sps_len={} pps_len={} total_bytes={total_bytes}",
                        s.len(), p.len()
                    );
                    let mut b = Fmp4Builder::new(codec);
                    b.set_init_segment(s, p);
                    emit_init(&b, &channel);
                    for ps in pending_slices.drain(..) {
                        emit_media(&mut b, &channel, &ps, &mut media_sent);
                    }
                    builder = Some(b);
                    log::info!(
                        "[device] read_loop: bootstrap done, continuing live stream"
                    );
                }
            }
        }

        // Throttled heartbeat so the user can watch frames flow without log spam.
        if reads.is_multiple_of(60) {
            log::info!(
                "[device] read_loop heartbeat: reads={reads} bytes={total_bytes} \
                 sps={nals_sps} pps={nals_pps} idr={nals_idr} nonidr={nals_nonidr} \
                 other={nals_other} media_sent={media_sent}"
            );
        }
    }
    log::info!(
        "[device] read_loop EXIT — reads={reads} bytes={total_bytes} \
         sps={nals_sps} pps={nals_pps} idr={nals_idr} nonidr={nals_nonidr} \
         other={nals_other} media_sent={media_sent}"
    );
}

/// Emit a slice NAL if the init segment has been sent, else queue it for the
/// post-bootstrap flush.
fn emit_or_pending(
    builder: &mut Option<Fmp4Builder>,
    channel: &Channel<DeviceFrame>,
    nal: &[u8],
    pending: &mut Vec<Vec<u8>>,
    media_sent: &mut u64,
) {
    if let Some(b) = builder.as_mut() {
        let frag = b.append_nal(nal);
        let _ = channel.send(DeviceFrame { kind: 1, bytes: frag });
        *media_sent += 1;
    } else {
        pending.push(nal.to_vec());
    }
}

fn run_control_loop(
    control_port: u16,
    rx: &mut mpsc::Receiver<ControlMessage>,
    stopping: Arc<AtomicBool>,
    ready_rx: tokio::sync::oneshot::Receiver<()>,
) {
    use std::io::Write;
    // Wait until video_stream socket is connected first to preserve scrcpy's accept() order.
    let _ = ready_rx.blocking_recv();

    let mut stream: Option<std::net::TcpStream> = None;
    for _attempt in 1..=30 {
        if stopping.load(Ordering::Relaxed) {
            return;
        }
        if let Ok(s) = std::net::TcpStream::connect(("127.0.0.1", control_port)) {
            stream = Some(s);
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    let mut stream = match stream {
        Some(s) => s,
        None => {
            log::warn!("[device] control_loop: TCP connect failed for 127.0.0.1:{control_port}");
            return;
        }
    };

    while !stopping.load(Ordering::Relaxed) {
        if let Ok(msg) = rx.try_recv() {
            let bytes = serialize_control_message(&msg);
            if stream.write_all(&bytes).is_err() {
                log::warn!("[device] control_loop write failed");
                break;
            }
        } else {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use super::super::control::TouchAction;

    #[test]
    fn run_control_loop_sends_messages_over_tcp() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, mut rx) = mpsc::channel::<ControlMessage>(128);
        let stopping = Arc::new(AtomicBool::new(false));
        let stop_clone = stopping.clone();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
        let _ = ready_tx.send(());

        let handle = std::thread::spawn(move || {
            run_control_loop(port, &mut rx, stop_clone, ready_rx);
        });

        let (mut socket, _) = listener.accept().unwrap();

        tx.try_send(ControlMessage::InjectTouch {
            action: TouchAction::Down,
            pointer_id: -1,
            x: 100,
            y: 200,
            width: 1080,
            height: 1920,
            pressure: 0xFFFF,
            buttons: 1,
        }).unwrap();

        let mut buf = [0u8; 32];
        let n = socket.read(&mut buf).unwrap();
        assert_eq!(n, 28);
        assert_eq!(buf[0], 2); // TYPE_INJECT_TOUCH = 2
        assert_eq!(buf[1], 0); // Action = Down = 0

        stopping.store(true, Ordering::Relaxed);
        handle.join().unwrap();
    }
}