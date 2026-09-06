use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};


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

impl DeviceEntry {
    /// Readiness: whether this Device is usable. adb reports a usable device
    /// with the state string "device"; everywhere else in the module should
    /// call this rather than compare against that literal directly.
    pub fn is_ready(&self) -> bool {
        self.state == "device"
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AvdEntry {
    pub name: String,
    /// Serial of the already-running instance, if this AVD is booted. The UI
    /// offers "attach" rather than "launch" when this is set, relaunching a
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

/// Every plausible SDK root, in probe order. Android Studio does not add
/// platform-tools to PATH, so for a stock install these directories are the
/// only way the tools are ever found.
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
        roots.push(home.join("Android").join("Sdk"));
    }
    roots.dedup();
    roots
}

/// Where a bootstrap install writes. A declared root outranks the default, so
/// a user who set ANDROID_HOME gets the SDK where they asked for it.
pub fn default_sdk_root() -> Option<PathBuf> {
    sdk_roots().into_iter().next()
}

fn find_in_sdk(subdir: &str, tool: &str) -> Option<PathBuf> {
    sdk_roots()
        .into_iter()
        .map(|root| root.join(subdir).join(tool))
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
        "adb not found on PATH or in the Android SDK. Install Android Platform Tools, or set ANDROID_HOME",
    )
}

pub fn resolve_emulator_path() -> Result<PathBuf, String> {
    resolve_tool(
        "emulator",
        "emulator",
        "emulator not found on PATH or in the Android SDK. Install the Android Emulator package, or set ANDROID_HOME",
    )
}

/// cmdline-tools binaries live in a versioned dir and, on older SDKs, in the
/// legacy `tools/bin`.
fn resolve_cmdline_tool(tool: &str, missing: &str) -> Result<PathBuf, String> {
    if let Ok(path) = which::which(tool) {
        return Ok(path);
    }
    for root in sdk_roots() {
        let cmdline = root.join("cmdline-tools");
        // `latest` is the conventional name; otherwise take any versioned dir.
        let mut candidates = vec![cmdline.join("latest").join("bin").join(tool)];
        if let Ok(entries) = std::fs::read_dir(&cmdline) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(tool));
            }
        }
        candidates.push(root.join("tools").join("bin").join(tool));
        if let Some(found) = candidates.into_iter().find(|p| p.is_file()) {
            return Ok(found);
        }
    }
    Err(missing.to_string())
}

pub fn resolve_avdmanager_path() -> Result<PathBuf, String> {
    resolve_cmdline_tool(
        "avdmanager",
        "avdmanager not found. Install the Android SDK Command-line Tools",
    )
}

pub fn resolve_sdkmanager_path() -> Result<PathBuf, String> {
    resolve_cmdline_tool(
        "sdkmanager",
        "sdkmanager not found. Install the Android SDK Command-line Tools",
    )
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
/// boots, which is both far slower and, measured on Mesa 26 / Fedora 44,
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
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch AVD '{name}': {e}"))?;
    Ok(LaunchedEmulator {
        serial: format!("emulator-{port}"),
        child,
        log_path,
    })
}

/// System images Terra offers to install. A hardcoded shortlist rather than
/// `sdkmanager --list`, which is slow and hits the network; the cost of the
/// choice is bumping this constant when a new Android ships.
const CATALOG_API_LEVELS: &[&str] = &["36", "35", "34"];

/// Google APIs images carry Play services without the Play Store's locked
/// system partition, which `adb root` and most preview work need.
const CATALOG_TAG: &str = "google_apis";

/// The system-image ABI matching the host. An emulator on a foreign ABI has to
/// translate every instruction, so Terra offers nothing rather than something
/// unusable.
pub fn host_image_abi() -> Option<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => Some("x86_64"),
        "aarch64" => Some("arm64-v8a"),
        _ => None,
    }
}

pub fn install_catalog() -> Vec<SystemImage> {
    let Some(abi) = host_image_abi() else {
        return Vec::new();
    };
    CATALOG_API_LEVELS
        .iter()
        .map(|api| {
            let api_level = format!("android-{api}");
            SystemImage {
                package: format!("system-images;{api_level};{CATALOG_TAG};{abi}"),
                api_level,
                tag: CATALOG_TAG.to_string(),
                abi: abi.to_string(),
            }
        })
        .collect()
}

/// Packages Terra may name alongside a system image, when the SDK lacks them.
const CATALOG_TOOLS: &[&str] = &["emulator", "platform-tools"];

/// The SDK root sdkmanager should write into. sdkmanager normally lives at
/// `<root>/cmdline-tools/<version>/bin/`, so the root is the nearest ancestor
/// that still holds `cmdline-tools`; a copy found on PATH says nothing about
/// the root, and falls back to the first probe root that exists.
pub fn sdk_root_for(sdkmanager: &Path) -> Option<PathBuf> {
    sdkmanager
        .ancestors()
        .skip(1)
        .take(5)
        .find(|dir| dir.join("cmdline-tools").is_dir())
        .map(PathBuf::from)
        .or_else(|| sdk_roots().into_iter().find(|root| root.is_dir()))
}

/// Single-quote for a POSIX shell, `'\''` being the one way to embed a quote.
/// zsh, bash and fish all read the result identically.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// A path is only safe to splice into a command line if it survives the trip
/// intact: a non-UTF-8 path would be mangled by a lossy conversion, and a
/// control character (a newline above all) ends the line the shell is reading.
fn shell_path(path: &Path) -> Result<String, String> {
    let text = path
        .to_str()
        .ok_or_else(|| format!("path is not valid UTF-8: {}", path.display()))?;
    if text.chars().any(char::is_control) {
        return Err(format!("path contains a control character: {text}"));
    }
    Ok(shell_quote(text))
}

/// Build the `sdkmanager` line Terra hands to a terminal tab, so the download
/// runs where the user can watch it, answer the SDK licence prompts and cancel.
///
/// This is a shell *line*, not an argv: package ids contain `;` and an SDK root
/// can contain a space. Every package is checked against what Terra offers, so
/// a value arriving over IPC can never name an arbitrary one, and every element
/// is quoted, so none of them can end the command.
pub fn build_sdk_install_command(
    sdkmanager: &Path,
    sdk_root: &Path,
    packages: &[String],
) -> Result<String, String> {
    if packages.is_empty() {
        return Err("no packages to install".to_string());
    }
    for package in packages {
        ensure_offered(package)?;
    }
    let mut line = vec![
        shell_path(sdkmanager)?,
        format!("--sdk_root={}", shell_path(sdk_root)?),
    ];
    line.extend(packages.iter().map(|package| shell_quote(package)));
    Ok(line.join(" "))
}

/// A package id arriving over IPC may only ever be one Terra itself offered.
fn ensure_offered(package: &str) -> Result<(), String> {
    let offered = CATALOG_TOOLS.contains(&package)
        || install_catalog().iter().any(|image| image.package == package);
    if offered {
        Ok(())
    } else {
        Err(format!("package not offered by Terra: {package}"))
    }
}

/// The cmdline-tools build the bootstrap fetches, and the digest it must hash
/// to. Google's repository manifest publishes only sha1, so this sha256 is
/// derived from the artifact once, after checking it against that published
/// sha1; bumping the build means re-deriving it the same way. A stale pin
/// costs only an older bootstrap tool, since sdkmanager updates itself and old
/// cmdline-tools install current packages.
const CMDLINE_TOOLS_BUILD: &str = "16111833";
const CMDLINE_TOOLS_SHA256: &str =
    "0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8";

/// What the bootstrap line calls beyond coreutils. `java` is here because
/// sdkmanager and avdmanager are Java programs; absence is worth naming before
/// a button is offered rather than after it fails.
const BOOTSTRAP_TOOLS: &[&str] = &["curl", "unzip", "sha256sum", "java"];

pub fn missing_bootstrap_tools() -> Vec<&'static str> {
    BOOTSTRAP_TOOLS
        .iter()
        .copied()
        .filter(|tool| which::which(tool).is_err())
        .collect()
}

/// Where the bootstrap stages its download. A fixed directory under the SDK
/// root rather than `mktemp -d`, because the line has to read identically in
/// fish, which has no `d=$(...)` assignment.
fn staging_dir(sdk_root: &Path) -> PathBuf {
    sdk_root.join(".terra-bootstrap")
}

/// The one-line path from a machine with no Android SDK at all to a system
/// image on disk: fetch the cmdline-tools, verify them, unpack them, then hand
/// over to `sdkmanager` for the tools and the image.
///
/// Terra downloads nothing itself; this runs in a terminal tab like every other
/// SDK install (`docs/adr/0005-terra-bootstraps-the-standalone-android-sdk.md`),
/// which is what keeps the bytes, Google's licence prompts and the cancel key
/// in front of the user.
///
/// Three constraints shape it. No variables and no command substitution, so
/// zsh, bash and fish read it identically. `&&` throughout, so a failed digest
/// never reaches the unzip. And no recursive delete: after the `mv` the staging
/// directory holds one file, so `rm -f` on it and `rmdir` (which refuses a
/// non-empty directory) are enough.
pub fn build_sdk_bootstrap_command(sdk_root: &Path, package: &str) -> Result<String, String> {
    ensure_offered(package)?;
    if CMDLINE_TOOLS_BUILD.is_empty() || !CMDLINE_TOOLS_BUILD.bytes().all(|b| b.is_ascii_digit()) {
        return Err("cmdline-tools build is not a number".to_string());
    }
    if CMDLINE_TOOLS_SHA256.len() != 64
        || !CMDLINE_TOOLS_SHA256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("cmdline-tools digest is not a sha256".to_string());
    }

    let cmdline = sdk_root.join("cmdline-tools");
    let latest = cmdline.join("latest");
    // A half-finished install is the one case where `mv` would nest rather than
    // land, so refuse it instead of writing into someone else's directory.
    if latest.exists() {
        return Err(format!(
            "{} already exists but holds no usable sdkmanager; move it aside and try again",
            latest.display()
        ));
    }

    let stage = staging_dir(sdk_root);
    let zip = shell_path(&stage.join("cmdline-tools.zip"))?;
    let stage_q = shell_path(&stage)?;
    let url = format!(
        "https://dl.google.com/android/repository/commandlinetools-linux-{CMDLINE_TOOLS_BUILD}_latest.zip"
    );

    let sdkmanager = latest.join("bin").join("sdkmanager");
    let mut packages: Vec<String> = CATALOG_TOOLS.iter().map(|t| (*t).to_string()).collect();
    packages.push(package.to_string());

    Ok([
        format!("mkdir -p {} {stage_q}", shell_path(&cmdline)?),
        format!(
            "curl -fL --proto '=https' --tlsv1.2 -o {zip} {}",
            shell_quote(&url)
        ),
        format!(
            "printf '%s  %s\\n' {} {zip} | sha256sum -c -",
            shell_quote(CMDLINE_TOOLS_SHA256)
        ),
        format!("unzip -q {zip} -d {stage_q}"),
        format!(
            "mv {} {}",
            shell_path(&stage.join("cmdline-tools"))?,
            shell_path(&latest)?
        ),
        format!("rm -f {zip}"),
        format!("rmdir {stage_q}"),
        build_sdk_install_command(&sdkmanager, sdk_root, &packages)?,
    ]
    .join(" && "))
}

/// Create an AVD from an already-installed system image. Installing one is
/// `build_sdk_install_command`, which runs in a terminal tab rather than here.
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
    fn is_ready_true_only_for_the_device_state() {
        let out = parse_devices_output(SAMPLE);
        assert!(out[0].is_ready(), "state \"device\" must be ready");
        assert!(!out[1].is_ready(), "state \"offline\" must not be ready");
        assert!(!out[2].is_ready(), "state \"unauthorized\" must not be ready");
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
    // The fake emulator is a POSIX shell script, so the test only runs where
    // one can be executed; the argv it checks is built the same way everywhere.
    #[test]
    fn launch_omits_gpu_flag_unless_explicitly_requested() {
        use std::os::unix::fs::PermissionsExt;

        let script = std::env::temp_dir().join("terra-test-fake-emulator.sh");
        let argv_dump = std::env::temp_dir().join("terra-test-emulator-argv.txt");
        let _ = std::fs::remove_file(&argv_dump);
        std::fs::write(
            &script,
            format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > {}\nsleep 5\n", argv_dump.display()),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

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
    fn sdk_roots_probe_the_linux_default_and_nothing_else() {
        let roots = sdk_roots();
        if dirs::home_dir().is_some() {
            assert!(roots.iter().any(|r| r.ends_with("Android/Sdk")));
        }
        // ADR 0002: no foreign-platform probes survive here.
        assert!(!roots.iter().any(|r| r.ends_with("Library/Android/sdk")));
    }

    #[test]
    fn default_sdk_root_prefers_a_declared_root() {
        // ANDROID_HOME is read at call time, so this only asserts the ordering
        // rule the function encodes rather than mutating the process env.
        let roots = sdk_roots();
        assert_eq!(default_sdk_root(), roots.into_iter().next());
    }

    #[test]
    fn install_command_refuses_a_package_terra_does_not_offer() {
        let tool = PathBuf::from("/sdk/cmdline-tools/latest/bin/sdkmanager");
        let root = PathBuf::from("/sdk");
        for package in [
            "system-images;android-36;google_apis_playstore;x86_64",
            "--uninstall",
            "emulator; rm -rf /",
            "",
        ] {
            assert!(
                build_sdk_install_command(&tool, &root, &[package.to_string()]).is_err(),
                "accepted {package}"
            );
        }
        assert!(build_sdk_install_command(&tool, &root, &[]).is_err());
    }

    #[test]
    fn install_command_quotes_every_element() {
        let tool = PathBuf::from("/an sdk/cmdline-tools/latest/bin/sdkmanager");
        let root = PathBuf::from("/an sdk/it's here");
        let package = install_catalog()
            .first()
            .expect("a catalog on a supported host")
            .package
            .clone();
        let line = build_sdk_install_command(&tool, &root, &["emulator".to_string(), package])
            .expect("a command");
        assert!(line.starts_with("'/an sdk/cmdline-tools/latest/bin/sdkmanager' "));
        assert!(line.contains(r"--sdk_root='/an sdk/it'\''s here'"));
        assert!(line.ends_with(&format!("'emulator' '{}'", install_catalog()[0].package)));
    }

    /// The real invariant: whatever the shell parses out of the line is exactly
    /// the argv we meant, with the `;` in a package id and the space and quote
    /// in the root intact rather than splitting or ending the command.
    #[test]
    #[cfg(unix)]
    fn shell_parses_the_install_line_back_into_the_argv() {
        let tool = PathBuf::from("/an sdk/cmdline-tools/latest/bin/sdkmanager");
        let root = PathBuf::from("/an sdk/it's here");
        let package = install_catalog()[0].package.clone();
        let line = build_sdk_install_command(&tool, &root, &["emulator".to_string(), package.clone()])
            .expect("a command");
        let out = Command::new("sh")
            .arg("-c")
            .arg(format!("set -- {line}; for a; do printf '%s\\n' \"$a\"; done"))
            .output()
            .expect("sh");
        assert!(out.status.success());
        let argv: Vec<String> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::to_string)
            .collect();
        assert_eq!(
            argv,
            vec![
                "/an sdk/cmdline-tools/latest/bin/sdkmanager".to_string(),
                "--sdk_root=/an sdk/it's here".to_string(),
                "emulator".to_string(),
                package,
            ]
        );
    }

    #[test]
    fn install_command_refuses_a_path_that_would_end_the_line() {
        let root = PathBuf::from("/sdk");
        let package = install_catalog()[0].package.clone();
        let newline = PathBuf::from("/sdk/bin/sdk\nmanager");
        assert!(build_sdk_install_command(&newline, &root, std::slice::from_ref(&package)).is_err());
        let tool = PathBuf::from("/sdk/cmdline-tools/latest/bin/sdkmanager");
        assert!(build_sdk_install_command(&tool, Path::new("/sdk\r"), &[package]).is_err());
    }

    #[test]
    fn catalog_packages_are_all_installable() {
        let tool = PathBuf::from("/sdk/cmdline-tools/latest/bin/sdkmanager");
        let root = PathBuf::from("/sdk");
        for image in install_catalog() {
            assert_eq!(image.tag, CATALOG_TAG);
            assert!(image.package.starts_with("system-images;"));
            build_sdk_install_command(&tool, &root, &[image.package]).expect("installable");
        }
    }

    /// A root that is awkward in every way the quoting has to survive.
    fn awkward_root() -> PathBuf {
        PathBuf::from("/an sdk/it's here")
    }

    #[cfg(unix)]
    fn argv_of(step: &str) -> Vec<String> {
        let out = Command::new("sh")
            .arg("-c")
            .arg(format!("set -- {step}; for a; do printf '%s\\n' \"$a\"; done"))
            .output()
            .expect("sh");
        assert!(out.status.success(), "sh rejected: {step}");
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn bootstrap_command_refuses_a_package_terra_does_not_offer() {
        for package in [
            "system-images;android-36;google_apis_playstore;x86_64",
            "--uninstall",
            "emulator; rm -rf /",
            "",
        ] {
            assert!(
                build_sdk_bootstrap_command(&awkward_root(), package).is_err(),
                "accepted {package}"
            );
        }
    }

    #[test]
    fn bootstrap_command_refuses_a_root_that_would_end_the_line() {
        let package = install_catalog()[0].package.clone();
        for root in ["/sdk\n", "/sdk\r"] {
            assert!(build_sdk_bootstrap_command(Path::new(root), &package).is_err());
        }
    }

    /// `mv` into an existing directory nests rather than lands, so a half
    /// finished install has to be refused rather than written into.
    #[test]
    fn bootstrap_command_refuses_an_existing_cmdline_tools_latest() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("Sdk");
        std::fs::create_dir_all(root.join("cmdline-tools").join("latest")).expect("layout");
        let package = install_catalog()[0].package.clone();
        assert!(build_sdk_bootstrap_command(&root, &package).is_err());
        std::fs::remove_dir_all(root.join("cmdline-tools").join("latest")).expect("clear");
        build_sdk_bootstrap_command(&root, &package).expect("a command once it is gone");
    }

    /// The line has to read the same in fish, which has neither `x=$(...)`
    /// assignment nor `$(...)` where bash would take it. No `$` and no backtick
    /// anywhere is the blunt form of that, and the one that cannot rot.
    #[test]
    fn bootstrap_line_is_free_of_variables_and_substitution() {
        let package = install_catalog()[0].package.clone();
        let line = build_sdk_bootstrap_command(&awkward_root(), &package).expect("a command");
        assert!(!line.contains('$'), "a variable survived in: {line}");
        assert!(!line.contains('`'), "a substitution survived in: {line}");
    }

    /// Terra never composes a recursive delete: after the `mv` the staging
    /// directory holds one file, so `rm -f` plus `rmdir` is the whole cleanup.
    #[test]
    fn bootstrap_line_never_deletes_recursively() {
        let package = install_catalog()[0].package.clone();
        let line = build_sdk_bootstrap_command(&awkward_root(), &package).expect("a command");
        assert!(!line.contains("rm -r"));
        assert!(!line.contains("rm -f -r"));
        assert!(line.contains("rmdir "));
    }

    /// The real invariant, step by step: whatever the shell parses out of each
    /// stage is exactly the argv we meant, with the space and the quote in the
    /// root and the `;` in the package id intact.
    #[test]
    #[cfg(unix)]
    fn shell_parses_the_bootstrap_line_back_into_the_argv() {
        let root = awkward_root();
        let package = install_catalog()[0].package.clone();
        let line = build_sdk_bootstrap_command(&root, &package).expect("a command");

        let steps: Vec<&str> = line.split(" && ").collect();
        assert_eq!(steps.len(), 8, "unexpected stage count in: {line}");

        let r = root.display().to_string();
        let stage = format!("{r}/.terra-bootstrap");
        let zip = format!("{stage}/cmdline-tools.zip");
        let latest = format!("{r}/cmdline-tools/latest");
        let owned = |args: &[&str]| args.iter().map(|a| (*a).to_string()).collect::<Vec<String>>();

        assert_eq!(
            argv_of(steps[0]),
            owned(&["mkdir", "-p", &format!("{r}/cmdline-tools"), &stage])
        );
        let curl = argv_of(steps[1]);
        assert_eq!(curl[0], "curl");
        assert_eq!(curl[curl.len() - 2], zip);
        assert_eq!(
            curl[curl.len() - 1],
            format!(
                "https://dl.google.com/android/repository/commandlinetools-linux-{CMDLINE_TOOLS_BUILD}_latest.zip"
            )
        );

        let (left, right) = steps[2].split_once(" | ").expect("a digest check");
        assert_eq!(
            argv_of(left),
            owned(&["printf", "%s  %s\\n", CMDLINE_TOOLS_SHA256, &zip])
        );
        assert_eq!(argv_of(right), owned(&["sha256sum", "-c", "-"]));

        assert_eq!(argv_of(steps[3]), owned(&["unzip", "-q", &zip, "-d", &stage]));
        assert_eq!(
            argv_of(steps[4]),
            owned(&["mv", &format!("{stage}/cmdline-tools"), &latest])
        );
        assert_eq!(argv_of(steps[5]), owned(&["rm", "-f", &zip]));
        assert_eq!(argv_of(steps[6]), owned(&["rmdir", &stage]));
        assert_eq!(
            argv_of(steps[7]),
            owned(&[
                &format!("{latest}/bin/sdkmanager"),
                &format!("--sdk_root={r}"),
                "emulator",
                "platform-tools",
                &package,
            ])
        );
    }

    /// `sha256sum -c` parses a line format of its own, and a path carrying a
    /// space or a quote has to survive that parse as well as the shell's.
    #[test]
    #[cfg(unix)]
    fn sha256sum_verifies_a_file_under_an_awkward_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("an sdk").join("it's here");
        std::fs::create_dir_all(&root).expect("layout");
        let file = root.join("cmdline-tools.zip");
        std::fs::write(&file, b"terra").expect("write");
        let digest = "9c1431eeb94d267d98b1b11898232ef7095e72b4ea3b269ad458e5a317c81ae8";
        let check = format!(
            "printf '%s  %s\\n' {} {} | sha256sum -c -",
            shell_quote(digest),
            shell_path(&file).expect("quotable")
        );
        let out = Command::new("sh")
            .arg("-c")
            .arg(&check)
            .output()
            .expect("sh");
        assert!(
            out.status.success(),
            "sha256sum rejected the check line: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[test]
    fn sdk_root_is_the_ancestor_holding_cmdline_tools() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("Sdk");
        let bin = root.join("cmdline-tools").join("latest").join("bin");
        std::fs::create_dir_all(&bin).expect("layout");
        assert_eq!(
            sdk_root_for(&bin.join("sdkmanager")).as_deref(),
            Some(root.as_path())
        );
    }
}
