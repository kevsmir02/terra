use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use crate::modules::proc::hide_console;

/// Emulator console ports are the even numbers in this range (16 slots); the
/// adb serial of an instance is always `emulator-<console port>`.
const EMULATOR_PORT_MIN: u16 = 5554;
const EMULATOR_PORT_MAX: u16 = 5584;

/// `-gpu` values we are willing to hand to the emulator. Restricted to an
/// allowlist so a stored preference can never splice arbitrary flags in.
pub const GPU_MODES: &[&str] = &[
    "auto",
    "host",
    "swiftshader_indirect",
    "angle_indirect",
    "guest",
    "off",
];

/// Software rendering. Slower than `host`, but the reliable choice when a
/// headless emulator can't get a GL surface.
pub const GPU_FALLBACK: &str = "swiftshader_indirect";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(
        export,
        export_to = "../../src/modules/device/generated/DeviceEntry.ts",
        optional_fields
    )
)]
pub struct DeviceEntry {
    pub serial: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AvdEntry {
    pub name: String,
    /// Serial of the already-running instance, if this AVD is booted. The UI
    /// offers "attach" rather than "launch" when this is set — relaunching a
    /// running AVD fails on its lock file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    /// Whether this process started it, and may therefore stop it again.
    pub managed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemImage {
    /// sdkmanager package id, e.g. `system-images;android-35;google_apis;x86_64`.
    pub package: String,
    pub api_level: String,
    pub tag: String,
    pub abi: String,
}

/// SDK tools carry `.exe` on Windows. `which` applies PATHEXT for us, but the
/// explicit SDK-directory probes below have to spell it out.
fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Every plausible SDK root, in probe order. Android Studio does not add
/// platform-tools to PATH on any platform, so for a stock install these
/// directories are the only way the tools are ever found.
pub fn sdk_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Ok(v) = std::env::var(var) {
            if !v.trim().is_empty() {
                roots.push(PathBuf::from(v));
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        // macOS default — note the lowercase `sdk`, which differs from Linux.
        roots.push(home.join("Library").join("Android").join("sdk"));
        // Linux default.
        roots.push(home.join("Android").join("Sdk"));
    }
    if cfg!(windows) {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("Android").join("Sdk"));
        }
    }
    roots.dedup();
    roots
}

fn find_in_sdk(subdir: &str, tool: &str) -> Option<PathBuf> {
    let file = exe(tool);
    sdk_roots()
        .into_iter()
        .map(|root| root.join(subdir).join(&file))
        .find(|p| p.is_file())
}

fn resolve_tool(tool: &str, subdir: &str, missing: &str) -> Result<PathBuf, String> {
    if let Ok(path) = which::which(tool) {
        return Ok(path);
    }
    find_in_sdk(subdir, tool).ok_or_else(|| missing.to_string())
}

pub fn resolve_adb_path() -> Result<PathBuf, String> {
    resolve_tool(
        "adb",
        "platform-tools",
        "adb not found on PATH or in the Android SDK — install Android Platform Tools, or set ANDROID_HOME",
    )
}

pub fn resolve_emulator_path() -> Result<PathBuf, String> {
    resolve_tool(
        "emulator",
        "emulator",
        "emulator not found on PATH or in the Android SDK — install the Android Emulator package, or set ANDROID_HOME",
    )
}

/// `avdmanager` ships in cmdline-tools (versioned dir) and, on older SDKs, in
/// the legacy `tools/bin`. It is a `.bat` on Windows rather than an `.exe`.
pub fn resolve_avdmanager_path() -> Result<PathBuf, String> {
    let file = if cfg!(windows) {
        "avdmanager.bat"
    } else {
        "avdmanager"
    };
    if let Ok(path) = which::which("avdmanager") {
        return Ok(path);
    }
    for root in sdk_roots() {
        let cmdline = root.join("cmdline-tools");
        // `latest` is the conventional name; otherwise take any versioned dir.
        let mut candidates = vec![cmdline.join("latest").join("bin").join(file)];
        if let Ok(entries) = std::fs::read_dir(&cmdline) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(file));
            }
        }
        candidates.push(root.join("tools").join("bin").join(file));
        if let Some(found) = candidates.into_iter().find(|p| p.is_file()) {
            return Ok(found);
        }
    }
    Err("avdmanager not found — install the Android SDK Command-line Tools".to_string())
}

/// Enumerate installed system images by walking `<sdk>/system-images`, which is
/// far cheaper and more reliable than `sdkmanager --list` (slow, and hits the
/// network). Layout is `system-images/<api>/<tag>/<abi>/`.
pub fn list_system_images() -> Vec<SystemImage> {
    let mut out = Vec::new();
    for root in sdk_roots() {
        let base = root.join("system-images");
        let Ok(apis) = std::fs::read_dir(&base) else {
            continue;
        };
        for api in apis.flatten() {
            let Ok(tags) = std::fs::read_dir(api.path()) else {
                continue;
            };
            for tag in tags.flatten() {
                let Ok(abis) = std::fs::read_dir(tag.path()) else {
                    continue;
                };
                for abi in abis.flatten() {
                    if !abi.path().is_dir() {
                        continue;
                    }
                    let (Some(api_level), Some(tag_name), Some(abi_name)) = (
                        api.file_name().to_str().map(str::to_string),
                        tag.file_name().to_str().map(str::to_string),
                        abi.file_name().to_str().map(str::to_string),
                    ) else {
                        continue;
                    };
                    out.push(SystemImage {
                        package: format!("system-images;{api_level};{tag_name};{abi_name}"),
                        api_level,
                        tag: tag_name,
                        abi: abi_name,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.package.cmp(&b.package));
    out.dedup();
    out
}

/// AVD names may contain letters, digits, `.`, `_`, `-` and spaces. A leading
/// `-` would be read as a flag by the emulator, so it is rejected outright.
pub fn is_safe_avd_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
}

/// Real serials are either `emulator-5554` or a `host:port` transport such as
/// `192.168.1.42:5555`. Anything else is refused at the IPC boundary so a
/// caller cannot point `adb -s` at an arbitrary network endpoint, and a leading
/// `-` cannot be read as a flag.
pub fn is_safe_serial(serial: &str) -> bool {
    !serial.is_empty()
        && serial.len() <= 256
        && !serial.starts_with('-')
        && serial
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':'))
}

pub fn ensure_safe_serial(serial: &str) -> Result<(), String> {
    if is_safe_serial(serial) {
        Ok(())
    } else {
        Err(format!("unsafe device serial: {serial}"))
    }
}

pub fn list_avd_names(emulator: &Path) -> Result<Vec<String>, String> {
    let mut cmd = Command::new(emulator);
    cmd.arg("-list-avds");
    hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("emulator -list-avds failed: {e}"))?;
    if !out.status.success() {
        return Err("emulator -list-avds failed".to_string());
    }
    Ok(parse_avd_names(&String::from_utf8_lossy(&out.stdout)))
}

pub fn parse_avd_names(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        // The emulator prints INFO/WARNING banners to stdout on some builds.
        .filter(|s| !s.is_empty() && !s.contains(' ') && !s.starts_with('['))
        .map(str::to_string)
        .collect()
}

/// `adb -s <serial> emu avd name` prints the AVD name then an `OK` status line.
pub fn parse_emu_avd_name(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && *l != "OK" && !l.starts_with("KO"))
        .map(str::to_string)
}

/// Map each running emulator's AVD name to its serial, so the UI can offer
/// "attach" instead of a launch that would fail on the AVD lock.
pub fn running_avds(adb: &Path, devices: &[DeviceEntry]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for d in devices.iter().filter(|d| d.serial.starts_with("emulator-")) {
        let mut cmd = Command::new(adb);
        cmd.args(["-s", &d.serial, "emu", "avd", "name"]);
        hide_console(&mut cmd);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                if let Some(name) = parse_emu_avd_name(&String::from_utf8_lossy(&out.stdout)) {
                    map.insert(name, d.serial.clone());
                }
            }
        }
    }
    map
}

fn port_is_bindable(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Pick a console port no running emulator owns. Checks adb's view *and* that
/// the port actually binds, which catches an instance that is still booting and
/// has not registered with adb yet.
pub fn free_emulator_port(devices: &[DeviceEntry]) -> Result<u16, String> {
    let used = used_emulator_ports(devices);
    (EMULATOR_PORT_MIN..=EMULATOR_PORT_MAX)
        .step_by(2)
        .find(|p| !used.contains(p) && port_is_bindable(*p))
        .ok_or_else(|| "no free emulator port in 5554-5584 (16 instances already running)".to_string())
}

pub fn used_emulator_ports(devices: &[DeviceEntry]) -> HashSet<u16> {
    devices
        .iter()
        .filter_map(|d| d.serial.strip_prefix("emulator-"))
        .filter_map(|p| p.parse::<u16>().ok())
        .collect()
}

#[derive(Debug)]
pub struct LaunchedEmulator {
    pub serial: String,
    pub child: Child,
    /// Combined stdout/stderr. The emulator reports the *reason* it died here
    /// and nowhere else, so this is the only way to explain a failure.
    pub log_path: PathBuf,
}

/// True when the host can plausibly provide hardware GL. On Linux a missing
/// display server is the one case where overriding the AVD's renderer with
/// software rendering is the right call rather than a regression.
pub fn host_has_display() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some()
    } else {
        true
    }
}

/// Last few lines of a launch log, for surfacing why an emulator died.
pub fn log_tail(path: &Path, lines: usize) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let interesting: Vec<&str> = text
        .lines()
        .filter(|l| {
            let l = l.to_ascii_lowercase();
            l.contains("error") || l.contains("failed") || l.contains("cannot") || l.contains("renderer")
        })
        .collect();
    let picked = if interesting.is_empty() {
        text.lines().rev().take(lines).collect::<Vec<_>>()
    } else {
        interesting.into_iter().rev().take(lines).collect::<Vec<_>>()
    };
    if picked.is_empty() {
        return None;
    }
    Some(
        picked
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("; ")
            .trim()
            .to_string(),
    )
}

/// Start an AVD headless. `-no-window` is the whole point: without it the
/// emulator opens its own OS window and the user is back to alt-tabbing, which
/// is precisely what streaming into Terra exists to avoid.
///
/// `gpu` is `None` by default *deliberately*. Passing any `-gpu` value
/// overrides the AVD's own `hw.gpu.mode`; when the two disagree the emulator
/// rejects its boot snapshot ("Change of GLES renderer detected") and cold
/// boots, which is both far slower and — measured on Mesa 26 / Fedora 44 —
/// a reliable segfault. Respecting the AVD's configuration boots in ~8s.
pub fn launch_avd(
    emulator: &Path,
    name: &str,
    port: u16,
    gpu: Option<&str>,
    log_path: PathBuf,
) -> Result<LaunchedEmulator, String> {
    if !is_safe_avd_name(name) {
        return Err(format!("unsafe AVD name: {name}"));
    }
    if let Some(gpu) = gpu {
        if !GPU_MODES.contains(&gpu) {
            return Err(format!("unsupported gpu mode: {gpu}"));
        }
    }
    let log = std::fs::File::create(&log_path)
        .map_err(|e| format!("cannot open emulator log {}: {e}", log_path.display()))?;
    let log_err = log
        .try_clone()
        .map_err(|e| format!("cannot clone emulator log handle: {e}"))?;

    let mut cmd = Command::new(emulator);
    cmd.arg("-avd")
        .arg(name)
        .arg("-port")
        .arg(port.to_string())
        .arg("-no-window")
        .arg("-no-boot-anim")
        // scrcpy is started with audio=false, so the emulator's audio backend
        // is dead weight and a common source of headless startup failures.
        .arg("-no-audio");
    if let Some(gpu) = gpu {
        cmd.arg("-gpu").arg(gpu);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    hide_console(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch AVD '{name}': {e}"))?;
    Ok(LaunchedEmulator {
        serial: format!("emulator-{port}"),
        child,
        log_path,
    })
}

/// Create an AVD from an already-installed system image. Downloading a new
/// image is deliberately out of scope — that needs sdkmanager, license
/// acceptance and a progress UI.
pub fn create_avd(avdmanager: &Path, name: &str, package: &str) -> Result<(), String> {
    use std::io::Write;

    if !is_safe_avd_name(name) {
        return Err(format!("unsafe AVD name: {name}"));
    }
    if !list_system_images().iter().any(|i| i.package == package) {
        return Err(format!("system image not installed: {package}"));
    }
    let mut cmd = Command::new(avdmanager);
    cmd.args(["create", "avd", "-n", name, "-k", package])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to run avdmanager: {e}"))?;
    // avdmanager interactively asks whether to use a custom hardware profile;
    // declining takes the sensible defaults.
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(b"no\n");
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("avdmanager failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "avdmanager create avd failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Ask the emulator console to shut down cleanly. Preferred over killing the
/// process so the AVD's disk image is not left dirty.
pub fn emu_kill(adb: &Path, serial: &str) -> Result<(), String> {
    let mut cmd = Command::new(adb);
    cmd.args(["-s", serial, "emu", "kill"]);
    hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("adb emu kill failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "adb emu kill exited {}: {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// True once Android's own boot has finished. A device can be visible to adb
/// for tens of seconds before this flips, and attaching scrcpy in that window
/// is a reliable way to get a black stream.
pub fn boot_completed(adb: &Path, serial: &str) -> bool {
    let mut cmd = Command::new(adb);
    cmd.args(["-s", serial, "shell", "getprop", "sys.boot_completed"]);
    hide_console(&mut cmd);
    cmd.output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "1")
        .unwrap_or(false)
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
    let mut cmd = Command::new(adb);
    cmd.args(["devices", "-l"]);
    hide_console(&mut cmd);
    let out = cmd
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

    #[test]
    fn safe_serial_accepts_real_transport_shapes() {
        assert!(is_safe_serial("emulator-5554"));
        assert!(is_safe_serial("192.168.1.42:5555"));
        assert!(is_safe_serial("1a2b3c4d"));
        assert!(is_safe_serial("R58M12ABCDE"));
    }

    #[test]
    fn safe_serial_rejects_flags_and_separators() {
        assert!(!is_safe_serial(""));
        assert!(!is_safe_serial("-e"));
        assert!(!is_safe_serial("--help"));
        assert!(!is_safe_serial("host 1"));
        assert!(!is_safe_serial("a/b"));
        assert!(!is_safe_serial("a;b"));
        assert!(!is_safe_serial("$(id)"));
        assert!(!is_safe_serial(&"a".repeat(257)));
    }

    #[test]
    fn ensure_safe_serial_surfaces_the_offending_value() {
        assert!(ensure_safe_serial("emulator-5554").is_ok());
        let err = ensure_safe_serial("-e").unwrap_err();
        assert!(err.contains("-e"), "error should name the value: {err}");
    }

    const SAMPLE: &str = "List of devices attached\n\
emulator-5554   device product:SDK_gphone64_x86_64 model:Pixel_SDK phone:emulator-5554\n\
emulator-5556   offline product:emu64 model:emu64 phone:emulator-5556\n\
192.168.1.42:5555   unauthorized\n\
\n";

    fn devices(serials: &[&str]) -> Vec<DeviceEntry> {
        serials
            .iter()
            .map(|s| DeviceEntry {
                serial: (*s).to_string(),
                state: "device".into(),
                product: None,
                model: None,
            })
            .collect()
    }

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

    #[test]
    fn parse_avd_names_skips_banners_and_blanks() {
        let s = "INFO    | Storing crashdata\nPixel_7_API_34\n\nPixel_Tablet_API_35\n";
        assert_eq!(
            parse_avd_names(s),
            vec!["Pixel_7_API_34".to_string(), "Pixel_Tablet_API_35".to_string()]
        );
    }

    #[test]
    fn parse_emu_avd_name_takes_name_not_status() {
        assert_eq!(
            parse_emu_avd_name("Pixel_7_API_34\nOK\n").as_deref(),
            Some("Pixel_7_API_34")
        );
        assert_eq!(parse_emu_avd_name("OK\n"), None);
        assert_eq!(parse_emu_avd_name("KO: unknown command\n"), None);
    }

    #[test]
    fn used_emulator_ports_reads_serials() {
        let used = used_emulator_ports(&devices(&["emulator-5554", "emulator-5558", "abc123"]));
        assert!(used.contains(&5554));
        assert!(used.contains(&5558));
        assert_eq!(used.len(), 2);
    }

    #[test]
    fn free_emulator_port_skips_ports_adb_reports_in_use() {
        let port = free_emulator_port(&devices(&["emulator-5554"])).expect("a free port");
        assert_ne!(port, 5554);
        assert!((EMULATOR_PORT_MIN..=EMULATOR_PORT_MAX).contains(&port));
        assert_eq!(port % 2, 0, "console ports are even");
    }

    #[test]
    fn avd_name_validation_rejects_flag_like_and_exotic_names() {
        assert!(is_safe_avd_name("Pixel_7_API_34"));
        assert!(is_safe_avd_name("My Phone-1.0"));
        assert!(!is_safe_avd_name(""));
        assert!(!is_safe_avd_name("-no-window"));
        assert!(!is_safe_avd_name("a;rm -rf /"));
        assert!(!is_safe_avd_name("a/b"));
        assert!(!is_safe_avd_name(&"x".repeat(129)));
    }

    #[test]
    fn launch_rejects_unsafe_name_and_gpu_before_spawning() {
        let fake = PathBuf::from("/nonexistent/emulator");
        let log = std::env::temp_dir().join("terra-test-launch.log");
        assert!(launch_avd(&fake, "-evil", 5554, None, log.clone())
            .unwrap_err()
            .contains("unsafe AVD name"));
        assert!(
            launch_avd(&fake, "Pixel", 5554, Some("; rm -rf /"), log)
                .unwrap_err()
                .contains("unsupported gpu mode")
        );
    }

    // Regression: forcing `-gpu` overrode the AVD's own `hw.gpu.mode`, which
    // made the emulator reject its boot snapshot ("Change of GLES renderer
    // detected") and segfault on the cold-boot path. Measured on Mesa 26 /
    // Fedora 44: `-gpu auto` and `-gpu swiftshader_indirect` both SEGV, while
    // omitting the flag boots in ~8s. `None` must stay the default.
    #[test]
    fn launch_omits_gpu_flag_unless_explicitly_requested() {
        let script = std::env::temp_dir().join("terra-test-fake-emulator.sh");
        let argv_dump = std::env::temp_dir().join("terra-test-emulator-argv.txt");
        let _ = std::fs::remove_file(&argv_dump);
        std::fs::write(
            &script,
            format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > {}\nsleep 5\n", argv_dump.display()),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let log = std::env::temp_dir().join("terra-test-nogpu.log");
        let mut launched = launch_avd(&script, "Pixel_API34", 5554, None, log).expect("spawn");
        // Give the shim a moment to write its argv, then stop it.
        std::thread::sleep(std::time::Duration::from_millis(400));
        let _ = launched.child.kill();
        let _ = launched.child.wait();

        let argv = std::fs::read_to_string(&argv_dump).unwrap_or_default();
        assert!(argv.contains("-no-window"), "headless flag missing: {argv}");
        assert!(argv.contains("Pixel_API34"));
        assert!(
            !argv.contains("-gpu"),
            "must not override the AVD's hw.gpu.mode by default: {argv}"
        );
    }

    #[test]
    fn log_tail_prefers_error_lines() {
        let path = std::env::temp_dir().join("terra-test-logtail.log");
        std::fs::write(
            &path,
            "INFO | booting\nWARNING | Change of GLES renderer detected\nINFO | more noise\n",
        )
        .unwrap();
        let tail = log_tail(&path, 3).expect("a tail");
        assert!(tail.contains("Change of GLES renderer detected"));
        assert!(!tail.contains("more noise"));
    }

    #[test]
    fn sdk_roots_include_platform_defaults() {
        // Guards against the regression this replaced: only ~/Android/Sdk was
        // probed, so stock macOS and Windows installs were never found.
        let roots = sdk_roots();
        if dirs::home_dir().is_some() {
            assert!(roots.iter().any(|r| r.ends_with("Library/Android/sdk")
                || r.ends_with("Library\\Android\\sdk")));
            assert!(roots.iter().any(|r| r.ends_with("Android/Sdk") || r.ends_with("Android\\Sdk")));
        }
    }

    #[test]
    fn exe_suffix_matches_platform() {
        assert_eq!(exe("adb"), if cfg!(windows) { "adb.exe" } else { "adb" });
    }
}
