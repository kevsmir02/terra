use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DeviceEntry {
    pub serial: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

pub fn resolve_adb_path() -> Result<PathBuf, String> {
    if let Ok(path) = which::which("adb") {
        return Ok(path);
    }
    if let Ok(home) = std::env::var("ANDROID_HOME").or_else(|_| std::env::var("ANDROID_SDK_ROOT")) {
        let p = PathBuf::from(home).join("platform-tools").join("adb");
        if p.exists() {
            return Ok(p);
        }
    }
    if let Some(home_dir) = dirs::home_dir() {
        let candidate = home_dir.join("Android").join("Sdk").join("platform-tools").join("adb");
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("adb not found on PATH or Android SDK directory — install Android Platform Tools".to_string())
}

pub fn resolve_emulator_path() -> Result<PathBuf, String> {
    if let Ok(path) = which::which("emulator") {
        return Ok(path);
    }
    if let Ok(home) = std::env::var("ANDROID_HOME").or_else(|_| std::env::var("ANDROID_SDK_ROOT")) {
        let p = PathBuf::from(home).join("emulator").join("emulator");
        if p.exists() {
            return Ok(p);
        }
    }
    if let Some(home_dir) = dirs::home_dir() {
        let candidate = home_dir.join("Android").join("Sdk").join("emulator").join("emulator");
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("emulator CLI not found on PATH or Android SDK directory".to_string())
}

pub fn list_avds(emulator: &std::path::Path) -> Result<Vec<String>, String> {
    let out = std::process::Command::new(emulator)
        .arg("-list-avds")
        .output()
        .map_err(|e| format!("emulator -list-avds failed: {e}"))?;
    if !out.status.success() {
        return Err("emulator -list-avds failed".to_string());
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let avds = stdout
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(avds)
}

pub fn launch_avd(emulator: &std::path::Path, name: &str) -> Result<(), String> {
    std::process::Command::new(emulator)
        .arg("-avd")
        .arg(name)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to launch AVD '{name}': {e}"))?;
    Ok(())
}

pub fn parse_devices_output(stdout: &str) -> Vec<DeviceEntry> {
    let mut out = Vec::new();
    let mut past_header = false;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !past_header {
            if trimmed.starts_with("List of devices attached") {
                past_header = true;
            }
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with('*') {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let Some(serial) = parts.next() else { continue };
        let Some(state) = parts.next() else { continue };
        let mut product = None;
        let mut model = None;
        for kv in parts {
            if let Some(value) = kv.strip_prefix("product:") {
                product = Some(value.to_string());
            } else if let Some(value) = kv.strip_prefix("model:") {
                model = Some(value.to_string());
            }
        }
        out.push(DeviceEntry {
            serial: serial.to_string(),
            state: state.to_string(),
            product,
            model,
        });
    }
    out
}

pub fn list_devices(adb: &std::path::Path) -> Result<Vec<DeviceEntry>, String> {
    let out = std::process::Command::new(adb)
        .args(["devices", "-l"])
        .output()
        .map_err(|e| format!("adb devices failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "adb devices exited {}: {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(parse_devices_output(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "List of devices attached\n\
emulator-5554   device product:SDK_gphone64_x86_64 model:Pixel_SDK phone:emulator-5554\n\
emulator-5556   offline product:emu64 model:emu64 phone:emulator-5556\n\
192.168.1.42:5555   unauthorized\n\
\n";

    #[test]
    fn parse_devices_output_handles_device_offline_unauthorized_and_blank_trailing() {
        let out = parse_devices_output(SAMPLE);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].serial, "emulator-5554");
        assert_eq!(out[0].state, "device");
        assert_eq!(out[0].product.as_deref(), Some("SDK_gphone64_x86_64"));
        assert_eq!(out[0].model.as_deref(), Some("Pixel_SDK"));
        assert_eq!(out[1].serial, "emulator-5556");
        assert_eq!(out[1].state, "offline");
        assert_eq!(out[2].serial, "192.168.1.42:5555");
        assert_eq!(out[2].state, "unauthorized");
        assert!(out[2].product.is_none());
    }

    #[test]
    fn parse_devices_output_ignores_daemon_banner_lines() {
        let s = "* daemon not running; starting now at tcp:5037\n\
* daemon started successfully\n\
List of devices attached\n\
emulator-5554   device\n";
        let out = parse_devices_output(s);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].serial, "emulator-5554");
    }

    #[test]
    fn parse_devices_output_empty_when_no_devices() {
        let out = parse_devices_output("List of devices attached\n\n");
        assert!(out.is_empty());
    }
}
