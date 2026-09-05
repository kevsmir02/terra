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
    let server_arg = format!(
        "app_process / com.genymobile.scrcpy.Server {SCRCPY_SERVER_VERSION} \
         tunnel_forward=true audio=false control=true cleanup=false \
         raw_stream=true max_size=1920 max_fps=30 video_codec=h264 scid={scid:08x}"
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
    push_jar_and_forward(adb, jar, serial, video_port, control_port, scid)?;
    let mut cmd = build_server_command(adb, jar, serial, scid);
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            remove_forwards(adb, serial, video_port, control_port);
            return Err(format!("scrcpy spawn failed: {e}"));
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
        assert!(args[4].contains("com.genymobile.scrcpy.Server 4.1 "));
        assert!(args[4].contains("tunnel_forward=true"));
        assert!(args[4].contains("control=true"));
        assert!(args[4].contains("raw_stream=true"));
        assert!(args[4].contains("audio=false"));
        assert!(args[4].contains("video_codec=h264"));
        assert!(args[4].contains("scid=0000002a"));
    }

    #[test]
    fn abstract_socket_name_formats_scid_as_lowercase_hex() {
        assert_eq!(abstract_socket_name(42), "scrcpy_0000002a");
        assert_eq!(abstract_socket_name(0), "scrcpy_00000000");
    }
}
