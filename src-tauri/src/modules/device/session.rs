use std::io::Read;
use std::net::{Shutdown, TcpStream};
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, Response};
use tokio::sync::mpsc;

use super::control::{serialize_control_message, ControlMessage};
use super::remux::StreamAssembler;
use super::state::SerialReservation;
use crate::modules::sync::MutexExt;

/// Closing the sockets tells the device-side server to exit on its own; this
/// is how long the local adb client gets to follow before it is killed.
const SHUTDOWN_BUDGET: Duration = Duration::from_secs(1);
const SHUTDOWN_POLL: Duration = Duration::from_millis(20);

/// How long the reader keeps retrying the connect+probe cycle before giving up
/// on a server that never became ready. A parameter so a test can exhaust it
/// in milliseconds instead of the twelve seconds production waits.
#[derive(Clone, Copy)]
struct ConnectBudget {
    attempts: u32,
    interval: Duration,
}

const CONNECT_BUDGET: ConnectBudget = ConnectBudget {
    attempts: 60,
    interval: Duration::from_millis(100),
};

/// Why a mirror session stopped, reported to the webview so it can tell a dead
/// stream from a frozen last frame.
#[derive(serde::Serialize, Clone)]
pub struct DeviceExit {
    pub reason: String,
}

/// Handles to the video and control sockets the IO threads own, so shutdown
/// can close them from outside and unblock a reader mid-`read`.
#[derive(Default)]
struct SocketRegistry {
    inner: Mutex<Sockets>,
}

#[derive(Default)]
struct Sockets {
    closed: bool,
    live: Vec<TcpStream>,
}

impl SocketRegistry {
    fn register(&self, stream: &TcpStream) {
        let clone = match stream.try_clone() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[device] socket handle clone failed; shutdown will rely on killing adb: {e}");
                return;
            }
        };
        let mut inner = self.inner.lock_or_recover();
        if inner.closed {
            let _ = clone.shutdown(Shutdown::Both);
            return;
        }
        inner.live.push(clone);
    }

    fn close_all(&self) {
        let mut inner = self.inner.lock_or_recover();
        inner.closed = true;
        for s in inner.live.drain(..) {
            let _ = s.shutdown(Shutdown::Both);
        }
    }
}

enum ChildPoll {
    Absent,
    Running,
    Exited,
}

trait ShutdownOps {
    fn close_sockets(&mut self);
    fn poll_child(&mut self) -> ChildPoll;
    fn kill_child(&mut self);
    fn remove_forwards(&mut self);
    fn sleep(&mut self, interval: Duration) {
        std::thread::sleep(interval);
    }
}

/// Sockets first so the server exits by itself, then a bounded wait for the
/// local adb client, a kill only if it outlives that, and the forwards last.
fn drive_shutdown<O: ShutdownOps>(ops: &mut O, budget: Duration, interval: Duration) {
    ops.close_sockets();
    let deadline = Instant::now() + budget;
    loop {
        match ops.poll_child() {
            ChildPoll::Absent | ChildPoll::Exited => break,
            ChildPoll::Running if Instant::now() >= deadline => {
                ops.kill_child();
                break;
            }
            ChildPoll::Running => ops.sleep(interval),
        }
    }
    ops.remove_forwards();
}

/// Everything a session owns that outlives the webview handle. Taken out of
/// the session exactly once, which is what makes `shutdown` idempotent.
struct Teardown {
    adb: PathBuf,
    serial: String,
    video_port: u16,
    control_port: u16,
    child: Option<Child>,
    sockets: Arc<SocketRegistry>,
    reservation: Arc<SerialReservation>,
    #[cfg(windows)]
    _job: Option<crate::modules::proc::job::ProcessJob>,
}

impl ShutdownOps for Teardown {
    fn close_sockets(&mut self) {
        self.sockets.close_all();
    }

    fn poll_child(&mut self) -> ChildPoll {
        match self.child.as_mut() {
            None => ChildPoll::Absent,
            Some(child) => match child.try_wait() {
                Ok(None) => ChildPoll::Running,
                Ok(Some(_)) | Err(_) => ChildPoll::Exited,
            },
        }
    }

    fn kill_child(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn remove_forwards(&mut self) {
        super::server::remove_forwards(&self.adb, &self.serial, self.video_port, self.control_port);
    }
}

pub struct DeviceSession {
    pub id: u32,
    pub serial: String,
    control_tx: Option<mpsc::Sender<ControlMessage>>,
    stopping: Arc<AtomicBool>,
    teardown: Option<Teardown>,
}

impl DeviceSession {
    /// Spawn a session: pushes the JAR, forwards the ports, starts the server,
    /// and starts the blocking-IO threads that read Annex-B NALs into fMP4
    /// frames sent raw (`[discriminator][payload]`, see `remux::decode_frame`)
    /// on `channel` and write control messages back.
    ///
    /// `video_port` and `control_port` are chosen by the caller from the OS
    /// ephemeral range (see `commands::ephemeral_ports`) and must be distinct.
    /// The reservation is released when the reader exits, on shutdown, or if
    /// this spawn fails.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        id: u32,
        adb: PathBuf,
        jar: PathBuf,
        serial: String,
        video_port: u16,
        control_port: u16,
        channel: Channel<Response>,
        on_exit: Channel<DeviceExit>,
        reservation: Arc<SerialReservation>,
    ) -> Result<Self, String> {
        let child = super::server::spawn_server(&adb, &jar, &serial, video_port, control_port)?;
        #[cfg(windows)]
        let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
            Ok(j) => Some(j),
            Err(e) => {
                log::warn!("[device] job-object setup failed for pid={}: {e}", child.id());
                None
            }
        };
        let stopping = Arc::new(AtomicBool::new(false));
        let sockets = Arc::new(SocketRegistry::default());

        let (tx, mut rx) = mpsc::channel::<ControlMessage>(128);
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();

        let stop_reader = stopping.clone();
        let reader_sockets = sockets.clone();
        let reader_reservation = Arc::clone(&reservation);
        tauri::async_runtime::spawn_blocking(move || {
            run_read_loop(
                video_port,
                channel,
                on_exit,
                stop_reader,
                Some(ready_tx),
                &reader_sockets,
                CONNECT_BUDGET,
            );
            reader_reservation.release();
        });

        let stop_control = stopping.clone();
        let control_sockets = sockets.clone();
        tauri::async_runtime::spawn_blocking(move || {
            run_control_loop(control_port, &mut rx, stop_control, ready_rx, &control_sockets);
        });

        Ok(Self {
            id,
            serial: serial.clone(),
            control_tx: Some(tx),
            stopping,
            teardown: Some(Teardown {
                adb,
                serial,
                video_port,
                control_port,
                child: Some(child),
                sockets,
                reservation,
                #[cfg(windows)]
                _job: job,
            }),
        })
    }

    #[cfg(test)]
    pub(super) fn stub(id: u32, serial: &str, control_tx: mpsc::Sender<ControlMessage>) -> Self {
        Self {
            id,
            serial: serial.to_string(),
            control_tx: Some(control_tx),
            stopping: Arc::new(AtomicBool::new(false)),
            teardown: None,
        }
    }

    /// `None` once the session has been shut down: the sender is dropped
    /// first thing in `shutdown`, which is also what unblocks a control loop
    /// parked in `blocking_recv`.
    pub fn control_tx(&self) -> Option<&mpsc::Sender<ControlMessage>> {
        self.control_tx.as_ref()
    }

    pub fn shutdown(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
        self.control_tx = None;
        let Some(mut teardown) = self.teardown.take() else { return };
        drive_shutdown(&mut teardown, SHUTDOWN_BUDGET, SHUTDOWN_POLL);
        teardown.reservation.release();
    }
}

impl Drop for DeviceSession {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Read the H.264 frame-metadata packet stream off
/// `TcpStream(127.0.0.1:local_port)` and
/// feed it through a `StreamAssembler`, forwarding each resulting encoded
/// frame (`[discriminator][payload]`, see `remux::decode_frame`) on `channel`
/// as `Response::new(frame)`. One channel keeps the frames in order, which is
/// why there is only one: the init frame must reach the media source before
/// the first media frame. Framing lives in the assembler; this loop only does
/// IO. `Channel::send` is synchronous (it just queues for the webview), so no
/// async runtime is needed in this thread.
///
/// When the stream dies on its own the loop reports why on `on_exit`; a stop
/// the webview asked for is not a death, so nothing is sent once `stopping` is
/// set (`shutdown` sets it before it closes the sockets that wake this read).
fn run_read_loop(
    local_port: u16,
    channel: Channel<Response>,
    on_exit: Channel<DeviceExit>,
    stopping: Arc<AtomicBool>,
    mut ready_tx: Option<tokio::sync::oneshot::Sender<()>>,
    sockets: &SocketRegistry,
    budget: ConnectBudget,
) {
    // adb forward maps the local TCP port IMMEDIATELY (before the scrcpy server
    // has even bound its abstract socket), so `connect()` succeeds right away even
    // when the remote side isn't ready: the first `read()` then returns 0 (EOF)
    // because adb closed the pipe. We must retry the full connect+probe cycle,
    // not just connect.
    let mut stream: Option<std::net::TcpStream> = None;
    let mut probe = [0u8; 1];
    for _attempt in 1..=budget.attempts {
        if stopping.load(Ordering::Relaxed) {
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
                        // abstract socket isn't ready; close and retry.
                        drop(s);
                        std::thread::sleep(budget.interval);
                        continue;
                    }
                    Ok(_) | Err(_) => {
                        // Data arrived or peek() isn't supported on this platform;
                        // either way we'll find out in the read loop. Switch back
                        // to blocking reads.
                        s.set_read_timeout(None).ok();
                        sockets.register(&s);
                        if let Some(tx) = ready_tx.take() {
                            let _ = tx.send(());
                        }
                        stream = Some(s);
                        break;
                    }
                }
            }
            Err(_) => {
                std::thread::sleep(budget.interval);
            }
        }
    }

    let mut stream = match stream {
        Some(s) => s,
        None => {
            log::warn!(
                "[device] read_loop: TCP connect failed after {} attempts, scrcpy server never became ready on 127.0.0.1:{local_port}",
                budget.attempts
            );
            report_exit(&on_exit, &stopping, "server-unreachable".to_string());
            return;
        }
    };

    let mut read_buf = [0u8; 65536];
    let mut assembler = StreamAssembler::default();
    let mut frames: Vec<Vec<u8>> = Vec::new();

    let reason = loop {
        if stopping.load(Ordering::Relaxed) {
            break None;
        }
        let n = match stream.read(&mut read_buf) {
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => {
                log::warn!("[device] read_loop: stream read error: {e}");
                break Some(format!("stream-error: {e}"));
            }
        };

        if n == 0 {
            assembler.finish(&mut frames);
            if !send_frames(&channel, &mut frames) {
                break None;
            }
            break Some("stream-ended".to_string());
        }

        assembler.push_bytes(&read_buf[..n], &mut frames);
        if !send_frames(&channel, &mut frames) {
            break None;
        }

        // Nothing can resynchronize a packet stream once a header stops making
        // sense, so reading on would only spin on bytes the assembler drops.
        if assembler.is_corrupt() {
            log::warn!("[device] read_loop: video stream desynchronized, stopping the reader");
            break Some("stream-corrupt".to_string());
        }
    };

    if let Some(reason) = reason {
        report_exit(&on_exit, &stopping, reason);
    }
}

/// A stop the webview asked for is not a failure, so the exit is suppressed
/// once `stopping` is set: nothing is left listening for it either way.
fn report_exit(on_exit: &Channel<DeviceExit>, stopping: &AtomicBool, reason: String) {
    if stopping.load(Ordering::Relaxed) {
        return;
    }
    if let Err(e) = on_exit.send(DeviceExit { reason }) {
        log::debug!("[device] exit send failed (channel closed): {e}");
    }
}

/// False once the webview dropped the frame channel: it will never read again,
/// so the reader stops rather than decoding into a void.
fn send_frames(channel: &Channel<Response>, frames: &mut Vec<Vec<u8>>) -> bool {
    for frame in frames.drain(..) {
        if let Err(e) = channel.send(Response::new(frame)) {
            log::debug!("[device] frame send failed (channel closed): {e}");
            return false;
        }
    }
    true
}

fn run_control_loop(
    control_port: u16,
    rx: &mut mpsc::Receiver<ControlMessage>,
    stopping: Arc<AtomicBool>,
    ready_rx: tokio::sync::oneshot::Receiver<()>,
    sockets: &SocketRegistry,
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
            sockets.register(&s);
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

    while let Some(msg) = rx.blocking_recv() {
        if stopping.load(Ordering::Relaxed) {
            break;
        }
        let bytes = serialize_control_message(&msg);
        if stream.write_all(&bytes).is_err() {
            log::warn!("[device] control_loop write failed");
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::net::{TcpListener, TcpStream};
    use std::time::Duration;
    use super::super::control::TouchAction;
    use super::super::state::DeviceState;

    struct Recorder {
        polls: VecDeque<ChildPoll>,
        calls: Vec<&'static str>,
    }

    impl Recorder {
        fn new(polls: impl IntoIterator<Item = ChildPoll>) -> Self {
            Self { polls: polls.into_iter().collect(), calls: Vec::new() }
        }
    }

    impl ShutdownOps for Recorder {
        fn close_sockets(&mut self) {
            self.calls.push("close_sockets");
        }
        fn poll_child(&mut self) -> ChildPoll {
            self.calls.push("poll");
            self.polls.pop_front().unwrap_or(ChildPoll::Running)
        }
        fn kill_child(&mut self) {
            self.calls.push("kill");
        }
        fn remove_forwards(&mut self) {
            self.calls.push("remove_forwards");
        }
        fn sleep(&mut self, _: Duration) {
            self.calls.push("sleep");
        }
    }

    #[test]
    fn drive_shutdown_closes_sockets_first_and_skips_kill_when_child_exits_in_time() {
        let mut ops = Recorder::new([ChildPoll::Running, ChildPoll::Running, ChildPoll::Exited]);
        drive_shutdown(&mut ops, Duration::from_secs(60), Duration::from_millis(1));
        assert_eq!(
            ops.calls,
            ["close_sockets", "poll", "sleep", "poll", "sleep", "poll", "remove_forwards"]
        );
    }

    #[test]
    fn drive_shutdown_kills_a_child_still_alive_after_the_budget() {
        let mut ops = Recorder::new([]);
        drive_shutdown(&mut ops, Duration::ZERO, Duration::from_millis(1));
        assert_eq!(ops.calls, ["close_sockets", "poll", "kill", "remove_forwards"]);
    }

    #[test]
    fn drive_shutdown_without_a_child_does_not_wait() {
        let mut ops = Recorder::new([ChildPoll::Absent]);
        drive_shutdown(&mut ops, Duration::from_secs(60), Duration::from_millis(1));
        assert_eq!(ops.calls, ["close_sockets", "poll", "remove_forwards"]);
    }

    fn connected_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let (server, _) = listener.accept().unwrap();
        (client, server)
    }

    #[test]
    fn socket_registry_close_all_unblocks_a_blocked_reader() {
        let (mut client, _server) = connected_pair();
        let registry = Arc::new(SocketRegistry::default());
        registry.register(&client);
        let reader = std::thread::spawn(move || {
            let mut b = [0u8; 8];
            client.read(&mut b)
        });
        std::thread::sleep(Duration::from_millis(30));
        registry.close_all();
        let result = reader.join().unwrap();
        assert!(matches!(result, Ok(0) | Err(_)), "reader must wake once the socket is shut down");
    }

    #[test]
    fn socket_registry_shuts_down_a_registration_that_arrives_after_close() {
        let (client, mut server) = connected_pair();
        let registry = SocketRegistry::default();
        registry.close_all();
        registry.register(&client);
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut b = [0u8; 8];
        assert_eq!(server.read(&mut b).unwrap(), 0, "late registration must be shut down at once");
    }

    #[test]
    fn shutdown_is_idempotent_and_releases_the_serial_once() {
        let state = DeviceState::default();
        let (tx, _rx) = mpsc::channel(1);
        let mut session = DeviceSession::stub(1, "emulator-5554", tx);
        session.teardown = Some(Teardown {
            adb: std::env::temp_dir().join("terra-missing-adb-for-tests"),
            serial: "emulator-5554".into(),
            video_port: 27183,
            control_port: 27184,
            child: None,
            sockets: Arc::new(SocketRegistry::default()),
            reservation: state.reserve_serial("emulator-5554").unwrap(),
            #[cfg(windows)]
            _job: None,
        });

        session.shutdown();
        assert!(session.teardown.is_none());
        assert!(session.stopping.load(Ordering::Relaxed));
        let newer = state.reserve_serial("emulator-5554").expect("shutdown released the serial");

        session.shutdown();
        drop(session);
        drop(newer);
        assert!(state.reserve_serial("emulator-5554").is_ok());
    }

    #[test]
    fn spawn_failure_releases_serial_reservation() {
        let state = super::super::state::DeviceState::default();
        let reservation = state.reserve_serial("emulator-5554").unwrap();
        let channel: Channel<Response> = Channel::new(|_| Ok(()));
        let on_exit: Channel<DeviceExit> = Channel::new(|_| Ok(()));
        let missing_adb = std::env::temp_dir().join("terra-missing-adb-for-tests");
        let result = DeviceSession::spawn(
            1,
            missing_adb.clone(),
            missing_adb,
            "emulator-5554".into(),
            27183,
            27184,
            channel,
            on_exit,
            reservation,
        );
        assert!(result.is_err(), "spawning against a missing adb binary must fail");
        assert!(state.reserve_serial("emulator-5554").is_ok(), "a failed spawn must release the serial");
    }

    /// Bounds a wait on a thread that is expected to unblock (a control loop
    /// exiting, a `blocking_recv` waking) so a regression that brings back a
    /// stuck receiver fails the test instead of hanging the suite.
    fn join_within<T>(handle: std::thread::JoinHandle<T>, budget: Duration) -> T {
        let deadline = Instant::now() + budget;
        while !handle.is_finished() {
            if Instant::now() >= deadline {
                panic!("thread did not finish within {budget:?}");
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        handle.join().expect("thread panicked")
    }

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
            run_control_loop(port, &mut rx, stop_clone, ready_rx, &SocketRegistry::default());
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
            action_button: 1,
            buttons: 1,
        }).unwrap();

        let mut buf = [0u8; 32];
        let n = socket.read(&mut buf).unwrap();
        assert_eq!(n, 32);
        assert_eq!(buf[0], 2); // TYPE_INJECT_TOUCH = 2
        assert_eq!(buf[1], 0); // Action = Down = 0

        drop(tx);
        join_within(handle, Duration::from_secs(2));
    }

    #[test]
    fn control_loop_exits_when_every_sender_is_dropped() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, mut rx) = mpsc::channel::<ControlMessage>(128);
        let stopping = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
        let _ = ready_tx.send(());

        let handle = std::thread::spawn(move || {
            run_control_loop(port, &mut rx, stopping, ready_rx, &SocketRegistry::default());
        });

        let (_socket, _) = listener.accept().unwrap();
        drop(tx);

        join_within(handle, Duration::from_secs(2));
    }

    #[test]
    fn shutdown_drops_the_control_sender() {
        let (tx, mut rx) = mpsc::channel::<ControlMessage>(1);
        let mut session = DeviceSession::stub(1, "emulator-5554", tx);

        session.shutdown();

        let handle = std::thread::spawn(move || rx.blocking_recv());
        assert_eq!(join_within(handle, Duration::from_secs(2)), None);
    }

    /// Collects the `reason` of every exit the read loop reports, so a test can
    /// assert both the reason and that exactly one (or no) exit was sent.
    fn capturing_exit_channel() -> (Channel<DeviceExit>, Arc<Mutex<Vec<String>>>) {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                let payload: serde_json::Value =
                    serde_json::from_str(&json).expect("exit payload is json");
                let reason = payload["reason"].as_str().expect("exit carries a reason");
                sink.lock_or_recover().push(reason.to_string());
            }
            Ok(())
        });
        (channel, seen)
    }

    fn test_budget(attempts: u32) -> ConnectBudget {
        ConnectBudget { attempts, interval: Duration::from_millis(10) }
    }

    #[test]
    fn read_loop_reports_stream_ended_when_the_server_closes() {
        use std::io::Write as _;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            // Fewer bytes than a packet header, so the assembler buffers them
            // and stays healthy: this is about EOF, not about framing.
            socket.write_all(&[0u8; 8]).unwrap();
            std::thread::sleep(Duration::from_millis(30));
        });

        let (on_exit, seen) = capturing_exit_channel();
        run_read_loop(
            port,
            Channel::new(|_| Ok(())),
            on_exit,
            Arc::new(AtomicBool::new(false)),
            None,
            &SocketRegistry::default(),
            test_budget(20),
        );

        server.join().unwrap();
        assert_eq!(*seen.lock_or_recover(), ["stream-ended"]);
    }

    #[test]
    fn read_loop_reports_server_unreachable_when_nothing_listens() {
        let port = TcpListener::bind("127.0.0.1:0")
            .map(|l| l.local_addr().unwrap().port())
            .unwrap();

        let (on_exit, seen) = capturing_exit_channel();
        let started = Instant::now();
        run_read_loop(
            port,
            Channel::new(|_| Ok(())),
            on_exit,
            Arc::new(AtomicBool::new(false)),
            None,
            &SocketRegistry::default(),
            test_budget(3),
        );

        assert_eq!(*seen.lock_or_recover(), ["server-unreachable"]);
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "the retry budget must bound how long the reader waits"
        );
    }

    #[test]
    fn read_loop_stays_silent_when_teardown_initiated_the_stop() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let stopping = Arc::new(AtomicBool::new(false));
        let sockets = Arc::new(SocketRegistry::default());
        let (on_exit, seen) = capturing_exit_channel();

        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
        let reader_stopping = Arc::clone(&stopping);
        let reader_sockets = Arc::clone(&sockets);
        let handle = std::thread::spawn(move || {
            run_read_loop(
                port,
                Channel::new(|_| Ok(())),
                on_exit,
                reader_stopping,
                Some(ready_tx),
                &reader_sockets,
                test_budget(20),
            );
        });

        let (_socket, _) = listener.accept().unwrap();
        ready_rx.blocking_recv().expect("the reader registers its socket before reading");

        // Exactly what shutdown() does, in the order it does it.
        stopping.store(true, Ordering::Relaxed);
        sockets.close_all();

        join_within(handle, Duration::from_secs(5));
        assert!(
            seen.lock_or_recover().is_empty(),
            "a webview-initiated stop is a teardown, not a session death"
        );
    }
}
