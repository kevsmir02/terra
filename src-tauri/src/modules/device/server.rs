use std::path::Path;
use std::process::Command;

use super::scrcpy_server_version::SCRCPY_SERVER_VERSION;

const DEVICE_JAR_PATH: &str = "/data/local/tmp/terax-scrcpy.jar";
const LOCAL_ABSTRACT_NAME: &str = "terax-scrcpy";

pub fn build_server_command(adb: &Path, jar: &Path, serial: &str, local_port: u16) -> Command {
    let _ = local_port;
    let classpath_arg = format!("CLASSPATH={DEVICE_JAR_PATH}");
    let server_arg = format!(
        "app_process / com.genymobile.scrcpy.Server {SCRCPY_SERVER_VERSION} \
         tunnel_forward=true audio=false control=false cleanup=false \
         raw_stream=true max_size=1920 max_fps=30 video_codec=h264"
    );
    let mut cmd = Command::new(adb);
    cmd.args(["-s", serial, "shell", &classpath_arg, &server_arg]);
    let _ = jar;
    cmd
}

pub fn push_jar_and_forward(adb: &Path, jar: &Path, serial: &str, local_port: u16) -> Result<(), String> {
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
    let forward_spec = format!("tcp:{local_port}");
    let abstract_spec = format!("localabstract:{LOCAL_ABSTRACT_NAME}");
    let fwd = Command::new(adb)
        .args(["-s", serial, "forward", &forward_spec, &abstract_spec])
        .output()
        .map_err(|e| format!("adb forward failed: {e}"))?;
    if !fwd.status.success() {
        return Err(format!(
            "adb forward exited {}: {}",
            fwd.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&fwd.stderr).trim()
        ));
    }
    Ok(())
}

pub fn spawn_server(adb: &Path, jar: &Path, serial: &str, local_port: u16) -> Result<std::process::Child, String> {
    push_jar_and_forward(adb, jar, serial, local_port)?;
    let mut cmd = build_server_command(adb, jar, serial, local_port);
    cmd.stdout(std::process::Stdio::piped())
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
        let cmd = build_server_command(&adb, &jar, "emulator-5554", 27183);
        assert_eq!(cmd.get_program(), std::ffi::OsStr::new("/usr/bin/adb"));
        let args: Vec<String> = cmd.get_args().map(|s| s.to_string_lossy().into_owned()).collect();
        assert_eq!(args[0], "-s");
        assert_eq!(args[1], "emulator-5554");
        assert_eq!(args[2], "shell");
        assert!(args[3].starts_with("CLASSPATH=/data/local/tmp/terax-scrcpy.jar"));
        assert!(args[4].contains("com.genymobile.scrcpy.Server 4.1 "));
        assert!(args[4].contains("tunnel_forward=true"));
        assert!(args[4].contains("control=false"));
        assert!(args[4].contains("raw_stream=true"));
        assert!(args[4].contains("audio=false"));
        assert!(args[4].contains("video_codec=h264"));
    }
}
