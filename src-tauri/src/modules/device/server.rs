use std::io::BufRead;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

use super::scrcpy_server_version::SCRCPY_SERVER_VERSION;

const DEVICE_JAR_PATH: &str = "/data/local/tmp/terra-scrcpy.jar";

/// scrcpy's client and server derive the abstract Unix socket name from the
/// scid the server was launched with. A private scid per session means two
/// mirror sessions, or a session and the user's own scrcpy client, never
/// share a socket name.
pub fn abstract_socket_name(scid: u32) -> String {
    format!("scrcpy_{scid:08x}")
}

static SCID_COUNTER: AtomicU32 = AtomicU32::new(0);

/// scrcpy's scid is a 31-bit value (the top bit is reserved), so this only
/// needs to be distinct across concurrent sessions in this process, not
/// cryptographically random: a randomized hasher seeded per call, mixed with
/// the process id and a per-process counter, is enough.
fn generate_scid() -> u32 {
    use std::hash::{BuildHasher, Hash, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    std::process::id().hash(&mut hasher);
    SCID_COUNTER.fetch_add(1, Ordering::Relaxed).hash(&mut hasher);
    (hasher.finish() as u32) & 0x7FFF_FFFF
}

pub fn build_server_command(adb: &Path, _jar: &Path, serial: &str, scid: u32) -> Command {
    let classpath_arg = format!("CLASSPATH={DEVICE_JAR_PATH}");
    // `clipboard_autosync=false` because nothing here reads the control
    // socket's device-message direction: a device that answers clipboard
    // changes would fill that socket's buffer with replies no one drains.
    let server_arg = format!(
        "app_process / com.genymobile.scrcpy.Server {SCRCPY_SERVER_VERSION} \
         tunnel_forward=true audio=false control=true cleanup=false clipboard_autosync=false \
         send_device_meta=false send_dummy_byte=false send_stream_meta=false send_frame_meta=true \
         video_bit_rate=4000000 max_size=1920 max_fps=30 video_codec=h264 scid={scid:08x}"
    );
    let mut cmd = Command::new(adb);
    cmd.args(["-s", serial, "shell", &classpath_arg, &server_arg]);
    cmd
}

pub fn push_jar_and_forward(
    adb: &Path,
    jar: &Path,
    serial: &str,
    video_port: u16,
    control_port: u16,
    scid: u32,
) -> Result<(), String> {
    let push = Command::new(adb)
        .args(["-s", serial, "push"])
        .arg(jar)
        .arg(DEVICE_JAR_PATH)
        .output()
        .map_err(|e| format!("adb push failed: {e}"))?;
    if !push.status.success() {
        return Err(format!(
            "adb push exited {}: {}",
            push.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&push.stderr).trim()
        ));
    }
    let forward_spec_video = format!("tcp:{video_port}");
    let forward_spec_control = format!("tcp:{control_port}");
    let abstract_spec = format!("localabstract:{}", abstract_socket_name(scid));

    let fwd_video = Command::new(adb)
        .args(["-s", serial, "forward", &forward_spec_video, &abstract_spec])
        .output()
        .map_err(|e| format!("adb forward video failed: {e}"))?;
    if !fwd_video.status.success() {
        return Err(format!("adb forward video failed: {}", String::from_utf8_lossy(&fwd_video.stderr)));
    }

    let fwd_control = Command::new(adb)
        .args(["-s", serial, "forward", &forward_spec_control, &abstract_spec])
        .output()
        .map_err(|e| format!("adb forward control failed: {e}"))?;
    if !fwd_control.status.success() {
        return Err(format!("adb forward control failed: {}", String::from_utf8_lossy(&fwd_control.stderr)));
    }
    Ok(())
}

/// Removes both forwarded ports for a serial. Best-effort: a stale forward is
/// harmless, but a failed open must not leak one.
pub fn remove_forwards(adb: &Path, serial: &str, video_port: u16, control_port: u16) {
    for port in [video_port, control_port] {
        let _ = Command::new(adb)
            .args(["-s", serial, "forward", "--remove", &format!("tcp:{port}")])
            .output();
    }
}

pub fn spawn_server(
    adb: &Path,
    jar: &Path,
    serial: &str,
    video_port: u16,
    control_port: u16,
) -> Result<std::process::Child, String> {
    let scid = generate_scid();
    let mut child = match push_and_launch(adb, jar, serial, video_port, control_port, scid) {
        Ok(child) => child,
        Err(e) => {
            // Every error from here on happens after `push_and_launch` may
            // already have created one or both forwards (the video forward
            // can succeed before the control forward fails, or the process
            // spawn itself can fail after both succeeded); a forward that was
            // never created is harmless to "remove", so one cleanup call
            // covers every case.
            remove_forwards(adb, serial, video_port, control_port);
            return Err(e);
        }
    };

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let r = std::io::BufReader::new(stderr);
            for line in r.lines() {
                match line {
                    Ok(l) => log::warn!("[device] scrcpy-server stderr: {l}"),
                    Err(_) => break,
                }
            }
        });
    }
    Ok(child)
}

fn push_and_launch(
    adb: &Path,
    jar: &Path,
    serial: &str,
    video_port: u16,
    control_port: u16,
    scid: u32,
) -> Result<std::process::Child, String> {
    push_jar_and_forward(adb, jar, serial, video_port, control_port, scid)?;
    let mut cmd = build_server_command(adb, jar, serial, scid);
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    cmd.spawn().map_err(|e| format!("scrcpy spawn failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn build_server_command_uses_serial_and_pinned_version() {
        let adb = PathBuf::from("/usr/bin/adb");
        let jar = PathBuf::from("/tmp/scrcpy-server-4.1.jar");
        let cmd = build_server_command(&adb, &jar, "emulator-5554", 42);
        assert_eq!(cmd.get_program(), std::ffi::OsStr::new("/usr/bin/adb"));
        let args: Vec<String> = cmd.get_args().map(|s| s.to_string_lossy().into_owned()).collect();
        assert_eq!(args[0], "-s");
        assert_eq!(args[1], "emulator-5554");
        assert_eq!(args[2], "shell");
        assert!(args[3].starts_with("CLASSPATH=/data/local/tmp/terra-scrcpy.jar"));
        assert_eq!(
            args[4],
            "app_process / com.genymobile.scrcpy.Server 4.1 \
             tunnel_forward=true audio=false control=true cleanup=false clipboard_autosync=false \
             send_device_meta=false send_dummy_byte=false send_stream_meta=false send_frame_meta=true \
             video_bit_rate=4000000 max_size=1920 max_fps=30 video_codec=h264 scid=0000002a"
        );
        // The muxer needs per-frame timestamps and explicit packet boundaries;
        // `raw_stream=true` would force every one of those meta options off.
        assert!(!args[4].contains("raw_stream"));
    }

    #[test]
    fn abstract_socket_name_formats_scid_as_lowercase_hex() {
        assert_eq!(abstract_socket_name(42), "scrcpy_0000002a");
        assert_eq!(abstract_socket_name(0), "scrcpy_00000000");
    }

    // Regression: the control forward is created after the video forward, so
    // a control-forward failure used to return early from
    // `push_jar_and_forward` with the video forward still standing; nothing
    // downstream ever removed it. A fake `adb` script (in the spirit of
    // adb::tests::launch_omits_gpu_flag_unless_explicitly_requested) lets this
    // be pinned without a real device: it succeeds for `push` and the video
    // `forward`, fails the control `forward`, and logs every `forward
    // --remove` it sees so the test can see both ports were cleaned up.
    #[test]
    fn spawn_server_removes_both_forwards_when_the_control_forward_fails() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir();
        let script = dir.join("terra-test-fake-adb-partial-forward.sh");
        let remove_log = dir.join("terra-test-fake-adb-partial-forward-removes.log");
        let _ = std::fs::remove_file(&remove_log);

        let video_port: u16 = 41000;
        let control_port: u16 = 41001;

        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\n\
                 if [ \"$3\" = push ]; then exit 0; fi\n\
                 if [ \"$3\" = forward ]; then\n\
                 if [ \"$4\" = --remove ]; then printf '%s\\n' \"$5\" >> {log}; exit 0; fi\n\
                 if [ \"$4\" = tcp:{control_port} ]; then exit 1; fi\n\
                 exit 0\n\
                 fi\n\
                 exit 0\n",
                log = remove_log.display(),
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

        let jar = PathBuf::from("/tmp/terra-test-irrelevant.jar");
        let result = spawn_server(&script, &jar, "emulator-5554", video_port, control_port);
        assert!(result.is_err(), "a failed control forward must surface as an error");

        let removed = std::fs::read_to_string(&remove_log).unwrap_or_default();
        assert!(removed.contains(&format!("tcp:{video_port}")), "video forward must be removed: {removed}");
        assert!(removed.contains(&format!("tcp:{control_port}")), "control forward must be removed too: {removed}");
    }
}
