use std::io::BufRead;
use std::path::Path;
use std::process::Command;

use super::scrcpy_server_version::SCRCPY_SERVER_VERSION;

const DEVICE_JAR_PATH: &str = "/data/local/tmp/terra-scrcpy.jar";
const LOCAL_ABSTRACT_NAME: &str = "scrcpy";

pub fn build_server_command(adb: &Path, _jar: &Path, serial: &str, _local_port: u16) -> Command {
    let classpath_arg = format!("CLASSPATH={DEVICE_JAR_PATH}");
    let server_arg = format!(
        "app_process / com.genymobile.scrcpy.Server {SCRCPY_SERVER_VERSION} \
         tunnel_forward=true audio=false control=true cleanup=false \
         raw_stream=true max_size=1920 max_fps=30 video_codec=h264"
    );
    let mut cmd = Command::new(adb);
    cmd.args(["-s", serial, "shell", &classpath_arg, &server_arg]);
    cmd
}

pub fn push_jar_and_forward(adb: &Path, jar: &Path, serial: &str, local_port: u16) -> Result<(), String> {
    // Kill any leftover scrcpy server instance on the device to avoid "Address already in use"
    let _ = Command::new(adb)
        .args(["-s", serial, "shell", "pkill -9 -f com.genymobile.scrcpy.Server || true"])
        .output();

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
    let forward_spec_video = format!("tcp:{local_port}");
    let forward_spec_control = format!("tcp:{}", local_port + 1);
    let abstract_spec = format!("localabstract:{LOCAL_ABSTRACT_NAME}");

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

pub fn spawn_server(adb: &Path, jar: &Path, serial: &str, local_port: u16) -> Result<std::process::Child, String> {
    push_jar_and_forward(adb, jar, serial, local_port)?;
    let mut cmd = build_server_command(adb, jar, serial, local_port);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    log::info!(
        "[device] scrcpy server spawning: serial={serial} local_port={local_port} adb={} jar={}",
        adb.display(), jar.display()
    );
    let mut child = cmd.spawn().map_err(|e| format!("scrcpy spawn failed: {e}"))?;

    // DIAGNOSTIC: scrcpy's stderr carries its startup line and any fatal (version
    // mismatch, unknown option, encoder failure). A server that dies here is
    // *invisible* — the forwarded TCP socket never opens and run_read_loop just
    // retries out → black `<video>`. Surface every stderr line so the cause shows.
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let r = std::io::BufReader::new(stderr);
            for line in r.lines() {
                match line {
                    Ok(l) => log::warn!("[device] scrcpy-server stderr: {l}"),
                    Err(_) => break,
                }
            }
            log::info!("[device] scrcpy-server stderr EOF (process exited)");
        });
    }

    // DIAGNOSTIC + LATENT FIX: stdout is piped (Stdio::piped()) but the read loop
    // reads video via the forwarded TCP socket, NOT stdout. An undrained pipe
    // fills at ~64KB and then blocks the server's writes → the server never
    // reaches the TCP-accept path. Drain stdout and log total bytes seen: if it
    // is non-trivial (>>64KB), that blocking was a second black-video cause.
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut r = std::io::BufReader::new(stdout);
            let mut total: u64 = 0;
            let mut one_shot_logged = false;
            let mut buf = [0u8; 4096];
            loop {
                match std::io::Read::read(&mut r, &mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        total += n as u64;
                        if !one_shot_logged {
                            one_shot_logged = true;
                            log::info!("[device] scrcpy-server stdout: first {} bytes (head)", n);
                        }
                        if total.is_multiple_of(1 << 20) {
                            log::info!("[device] scrcpy-server stdout: {total} bytes total");
                        }
                    }
                    Err(_) => break,
                }
            }
            log::info!("[device] scrcpy-server stdout EOF after total={total} bytes");
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
        let cmd = build_server_command(&adb, &jar, "emulator-5554", 27183);
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
    }
}
