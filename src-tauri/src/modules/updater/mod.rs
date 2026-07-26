pub mod package;
pub mod verify;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use ureq::ResponseExt;

use crate::modules::proc::hide_console;
use package::PackageKind;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// Hosts a release asset may legitimately come from. The URL arrives from the
/// webview, so without this the command would be a general-purpose fetch
/// primitive running outside the browser's own restrictions.
const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

fn is_allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.split('@').next_back().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");
    !host.is_empty() && ALLOWED_HOSTS.contains(&host)
}

/// Every hop in a redirect chain must land on an allowed host, not just the
/// final one: `ureq` follows redirects on its own, and a malicious or
/// compromised intermediate hop could otherwise reach an arbitrary host (an
/// SSRF/port-scan oracle) before eventually landing somewhere allowed. Takes
/// plain strings so it is unit-testable without a network round trip.
fn all_hops_allowed<'a>(hops: impl IntoIterator<Item = &'a str>) -> bool {
    hops.into_iter().all(is_allowed_url)
}

/// Validates every hop `ureq` actually took to produce `resp` against the
/// allowlist. Requires the agent to be configured with
/// `save_redirect_history(true)` (see `download_agent` below); falls back to
/// just the final URL if that history isn't available.
fn verify_response_hosts(resp: &ureq::http::Response<ureq::Body>) -> Result<(), String> {
    let hops: Vec<String> = resp
        .get_redirect_history()
        .map(|h| h.iter().map(ToString::to_string).collect())
        .unwrap_or_else(|| vec![resp.get_uri().to_string()]);
    if all_hops_allowed(hops.iter().map(String::as_str)) {
        Ok(())
    } else {
        Err("refusing to follow a redirect to an unexpected host".to_string())
    }
}

/// No published Terra package is anywhere near this size. A response
/// reporting more via `Content-Length` — or one that just keeps sending data
/// regardless of what it reported — is refused outright rather than trusted
/// to allocate however much memory it likes.
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;

/// Checked against the reported `Content-Length` before a single byte is
/// read, and again against the running total on every chunk, so neither a
/// lying header nor an absent one can turn this into an unbounded
/// allocation. A free function so the cap logic is unit-testable without a
/// network round trip.
fn enforce_download_cap(total: Option<u64>, downloaded: u64) -> Result<(), String> {
    if total.is_some_and(|t| t > MAX_DOWNLOAD_BYTES) || downloaded > MAX_DOWNLOAD_BYTES {
        Err(format!("refusing to download more than {MAX_DOWNLOAD_BYTES} bytes"))
    } else {
        Ok(())
    }
}

/// Shared safety settings and timeouts for both requests `updater_download`
/// makes.
///
/// - `https_only` stops a redirect from silently downgrading to plaintext.
/// - `save_redirect_history` is what lets `verify_response_hosts` check every
///   hop, not just the final URL.
/// - `timeout_connect` bounds how long a dead socket can block the
///   `spawn_blocking` thread before the handshake even starts; 30s is
///   generous for DNS + TLS and short enough that a black-holed connection
///   no longer blocks indefinitely.
/// - `timeout_global` is a hard backstop for the *entire* call, deliberately
///   loose (30 minutes): tight enough that a stalled or dropped connection
///   can no longer strand the UI in `downloading` forever (the bug this
///   fixes), loose enough that a real, large package on a slow-but-live
///   connection still has time to finish.
fn download_agent() -> ureq::Agent {
    let config = ureq::config::Config::builder()
        .https_only(true)
        .save_redirect_history(true)
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_global(Some(Duration::from_secs(30 * 60)))
        .build();
    ureq::Agent::new_with_config(config)
}

/// A downloaded package is only ever addressed by bare file name. Anything
/// with a separator, a parent component, or an empty/relative-marker name is
/// refused, so a compromised webview cannot steer the privileged install at an
/// arbitrary file on disk.
fn safe_staged_path(dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains('/')
        || file_name.contains('\\')
    {
        return Err(format!("refusing unsafe update file name: {file_name}"));
    }
    Ok(dir.join(file_name))
}

/// Appends `.sig` to the whole file name. `Path::with_extension` would
/// *replace* the extension, turning `Terra-0.8.6-1.x86_64.rpm` into
/// `Terra-0.8.6-1.x86_64.sig` — which is not the name the release publishes.
fn sig_path(pkg: &Path) -> PathBuf {
    let mut name = pkg.as_os_str().to_os_string();
    name.push(".sig");
    PathBuf::from(name)
}

fn staging_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no app cache dir: {e}"))?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create staging dir: {e}"))?;
    Ok(dir)
}

/// At most one staged package exists at a time, so an abandoned download from
/// an earlier session can never be installed by accident.
fn clear_staging(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// The pubkey the updater plugin already validates against on macOS/Windows.
/// Read from config so there is exactly one source of truth.
fn configured_pubkey(app: &AppHandle) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "no updater pubkey configured".to_string())
}

#[tauri::command]
pub async fn updater_package_kind() -> Result<PackageKind, String> {
    tauri::async_runtime::spawn_blocking(package::detect)
        .await
        .map_err(|e| format!("updater_package_kind join: {e}"))
}

/// Downloads the package and its signature straight into the staging dir,
/// reporting progress over `on_progress`. The bytes never cross IPC.
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    package_url: String,
    signature_url: String,
    file_name: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<String, String> {
    if !is_allowed_url(&package_url) || !is_allowed_url(&signature_url) {
        return Err("refusing to download from an unexpected host".to_string());
    }
    let dir = staging_dir(&app)?;
    let path = safe_staged_path(&dir, &file_name)?;
    let pubkey = configured_pubkey(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        clear_staging(&dir);
        let agent = download_agent();

        let mut sig_resp = agent
            .get(&signature_url)
            .call()
            .map_err(|e| format!("signature download failed: {e}"))?;
        verify_response_hosts(&sig_resp)?;
        let signature = sig_resp
            .body_mut()
            .read_to_string()
            .map_err(|e| format!("signature download failed: {e}"))?;

        let resp = agent
            .get(&package_url)
            .call()
            .map_err(|e| format!("download failed: {e}"))?;
        verify_response_hosts(&resp)?;
        let total = resp
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        enforce_download_cap(total, 0)?;

        let mut reader = resp.into_body().into_reader();
        let mut bytes: Vec<u8> =
            Vec::with_capacity(total.unwrap_or(0).min(MAX_DOWNLOAD_BYTES) as usize);
        let mut buf = vec![0u8; 64 * 1024];
        let mut downloaded: u64 = 0;
        loop {
            let n = std::io::Read::read(&mut reader, &mut buf)
                .map_err(|e| format!("download failed: {e}"))?;
            if n == 0 {
                break;
            }
            downloaded += n as u64;
            enforce_download_cap(total, downloaded)?;
            bytes.extend_from_slice(&buf[..n]);
            let _ = on_progress.send(DownloadProgress { downloaded, total });
        }

        // Verify before anything lands on disk, so a tampered or truncated
        // download leaves nothing behind to install.
        verify::verify(&pubkey, &bytes, &signature)?;
        fs::write(&path, &bytes).map_err(|e| format!("could not stage update: {e}"))?;
        fs::write(sig_path(&path), signature.as_bytes())
            .map_err(|e| format!("could not stage signature: {e}"))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("updater_download join: {e}"))?
}

/// Reads the version from the package itself rather than its file name: the
/// signature covers content, not the name it was saved under.
fn package_version(kind: PackageKind, path: &Path) -> Result<String, String> {
    let p = path.to_string_lossy().into_owned();
    let (bin, args): (&str, Vec<String>) = match kind {
        PackageKind::Rpm => (
            "rpm",
            vec!["-qp".into(), "--nosignature".into(), "--qf".into(), "%{VERSION}".into(), p],
        ),
        PackageKind::Deb => ("dpkg-deb", vec!["-f".into(), p, "Version".into()]),
        PackageKind::Unsupported => return Err("unsupported package kind".to_string()),
    };
    if which::which(bin).is_err() {
        return Err(format!("{bin} is not available to read the package version"));
    }
    let mut cmd = Command::new(bin);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::null());
    hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("could not read the package version: {e}"))?;
    if !out.status.success() {
        return Err("could not read the package version".to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Strictly-newer comparison that fails closed on anything it cannot parse.
fn is_newer(candidate: &str, current: &str) -> bool {
    fn parts(v: &str) -> Option<Vec<u64>> {
        let core = v.trim().split('-').next()?.trim();
        if core.is_empty() {
            return None;
        }
        core.split('.').map(|p| p.parse::<u64>().ok()).collect()
    }
    let (Some(a), Some(b)) = (parts(candidate), parts(current)) else {
        return false;
    };
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

#[tauri::command]
pub async fn updater_install(app: AppHandle, file_name: String) -> Result<(), String> {
    let dir = staging_dir(&app)?;
    let path = safe_staged_path(&dir, &file_name)?;
    let pubkey = configured_pubkey(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        // Re-verify immediately before escalating: verifying only at stage
        // time would leave a window in which the file could be swapped.
        let bytes = fs::read(&path).map_err(|e| format!("staged update missing: {e}"))?;
        let signature = fs::read_to_string(sig_path(&path))
            .map_err(|e| format!("staged signature missing: {e}"))?;
        verify::verify(&pubkey, &bytes, &signature)?;

        let kind = package::detect();
        let version = package_version(kind, &path)?;
        let current = env!("CARGO_PKG_VERSION");
        if !is_newer(&version, current) {
            return Err(format!(
                "refusing to install {version} over {current} — updates must move forward"
            ));
        }

        let (bin, args) = package::install_command(kind, &path)
            .ok_or_else(|| "this install format cannot be updated in place".to_string())?;

        let mut cmd = Command::new(bin);
        cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
        hide_console(&mut cmd);
        let out = cmd
            .output()
            .map_err(|e| format!("could not launch the installer: {e}"))?;

        match out.status.code() {
            Some(0) => {
                clear_staging(&dir);
                Ok(())
            }
            // polkit's documented exit codes for dismissal and refusal.
            Some(126) => Err("cancelled".to_string()),
            Some(127) => Err("not authorized".to_string()),
            _ => {
                let err = String::from_utf8_lossy(&out.stderr);
                let tail: String = err.lines().rev().take(5).collect::<Vec<_>>().join("\n");
                Err(format!("install failed: {tail}"))
            }
        }
    })
    .await
    .map_err(|e| format!("updater_install join: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn accepts_a_plain_file_name() {
        let p = safe_staged_path(Path::new("/tmp/stage"), "Terra-0.8.6-1.x86_64.rpm").unwrap();
        assert_eq!(p, Path::new("/tmp/stage/Terra-0.8.6-1.x86_64.rpm"));
    }

    #[test]
    fn rejects_parent_traversal() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "../../etc/passwd").is_err());
    }

    #[test]
    fn rejects_a_bare_parent_component() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "..").is_err());
    }

    #[test]
    fn rejects_forward_slashes() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "sub/pkg.rpm").is_err());
    }

    #[test]
    fn rejects_backslashes() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "sub\\pkg.rpm").is_err());
    }

    #[test]
    fn rejects_an_absolute_path() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "/etc/passwd").is_err());
    }

    #[test]
    fn rejects_an_empty_name() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), "").is_err());
    }

    #[test]
    fn rejects_a_dotfile_current_dir() {
        assert!(safe_staged_path(Path::new("/tmp/stage"), ".").is_err());
    }

    #[test]
    fn sig_path_appends_rather_than_replacing_the_extension() {
        // The release publishes Terra-0.8.6-1.x86_64.rpm.sig — NOT
        // Terra-0.8.6-1.x86_64.sig, which is what with_extension would give.
        assert_eq!(
            sig_path(Path::new("/tmp/stage/Terra-0.8.6-1.x86_64.rpm")),
            Path::new("/tmp/stage/Terra-0.8.6-1.x86_64.rpm.sig")
        );
    }

    #[test]
    fn is_newer_accepts_a_higher_patch() {
        assert!(is_newer("0.8.6", "0.8.5"));
    }

    #[test]
    fn is_newer_rejects_an_equal_version() {
        // The bug this task exists for: an equal version means dnf exits 0
        // having done nothing, after prompting for a password.
        assert!(!is_newer("0.8.5", "0.8.5"));
    }

    #[test]
    fn is_newer_rejects_a_downgrade() {
        assert!(!is_newer("0.8.4", "0.8.5"));
    }

    #[test]
    fn is_newer_compares_numerically_not_lexically() {
        assert!(is_newer("0.10.0", "0.9.0"));
    }

    #[test]
    fn is_newer_fails_closed_on_unparseable_input() {
        assert!(!is_newer("", "0.8.5"));
        assert!(!is_newer("not-a-version", "0.8.5"));
        assert!(!is_newer("0.8.6", ""));
    }

    #[test]
    fn accepts_https_github_asset_urls() {
        assert!(is_allowed_url("https://github.com/o/r/releases/download/v1/a.rpm"));
        assert!(is_allowed_url(
            "https://release-assets.githubusercontent.com/github-production-release-asset/1/2"
        ));
        assert!(is_allowed_url("https://objects.githubusercontent.com/x"));
    }

    #[test]
    fn rejects_non_https_schemes() {
        // The URL comes from the webview; without this the command is an
        // arbitrary-fetch primitive pointed at the local network.
        assert!(!is_allowed_url("http://github.com/o/r/a.rpm"));
        assert!(!is_allowed_url("file:///etc/passwd"));
        assert!(!is_allowed_url("ftp://github.com/a.rpm"));
    }

    #[test]
    fn rejects_unrelated_hosts() {
        assert!(!is_allowed_url("https://evil.test/a.rpm"));
        assert!(!is_allowed_url("http://127.0.0.1:8080/a.rpm"));
        assert!(!is_allowed_url("https://github.com.evil.test/a.rpm"));
    }

    #[test]
    fn rejects_a_hostless_url() {
        assert!(!is_allowed_url("https:///a.rpm"));
        assert!(!is_allowed_url("not a url"));
    }

    #[test]
    fn all_hops_allowed_accepts_a_redirect_chain_that_stays_on_allowlisted_hosts() {
        // The exact happy path: GitHub asset URLs 302 to the CDN host.
        assert!(all_hops_allowed([
            "https://github.com/o/r/releases/download/v1/a.rpm",
            "https://release-assets.githubusercontent.com/github-production-release-asset/1/2",
        ]));
    }

    #[test]
    fn all_hops_allowed_rejects_a_chain_with_any_disallowed_hop() {
        // Even if the chain ends up back on an allowed host, a hop through
        // an unexpected one in between must not be trusted.
        assert!(!all_hops_allowed([
            "https://github.com/o/r/releases/download/v1/a.rpm",
            "https://evil.test/steal-me",
            "https://release-assets.githubusercontent.com/x",
        ]));
        assert!(!all_hops_allowed(["https://evil.test/a.rpm"]));
    }

    #[test]
    fn enforce_download_cap_accepts_sizes_within_the_limit() {
        assert!(enforce_download_cap(Some(1024), 1024).is_ok());
        assert!(enforce_download_cap(None, 1024).is_ok());
    }

    #[test]
    fn enforce_download_cap_rejects_a_reported_size_over_the_limit() {
        // A malicious or broken server can claim any Content-Length; it must
        // be rejected before a single byte is read, not just once actually
        // received.
        assert!(enforce_download_cap(Some(MAX_DOWNLOAD_BYTES + 1), 0).is_err());
    }

    #[test]
    fn enforce_download_cap_rejects_accumulated_bytes_over_the_limit_even_without_a_header() {
        // No Content-Length header at all must not be a free pass to stream
        // forever.
        assert!(enforce_download_cap(None, MAX_DOWNLOAD_BYTES + 1).is_err());
    }
}
