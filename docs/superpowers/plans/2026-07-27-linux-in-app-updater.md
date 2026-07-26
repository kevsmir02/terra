# Linux In-App Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Linux users check for, download, verify, and install an update from the About panel — with a polkit password prompt and an automatic relaunch — without any background check or interrupting modal.

**Architecture:** The webview downloads the `.rpm`/`.deb` and its `.sig` (it already holds the `https:` network permission; Rust has no HTTP client since the AI purge). Bytes cross IPC once into a new Rust `updater` module that stages them in the app cache dir, verifies the minisign signature against the pubkey already in `tauri.conf.json`, and installs via `pkexec dnf install` / `pkexec apt-get install`. The privileged and security-critical half lives in Rust; the byte-shovelling lives in JS.

**Tech Stack:** Rust (Tauri 2, `minisign-verify`, `which`, `dirs`), TypeScript/React 19, vitest, GitHub Actions.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-linux-in-app-updater-design.md`
- Formats: RPM and DEB only, x86_64 only. AppImage and other arches fall back to the manual release-page flow.
- **No automatic update check on any platform.** No network call on launch, no modal, ever.
- Signature verification is mandatory before any privileged call, and is performed **twice** — at stage time and again inside `updater_install`.
- `file_name` parameters crossing IPC are bare filenames. Any value containing a path separator or `..` is rejected.
- The updater pubkey is read at runtime from `app.config()`, never duplicated in a constant.
- Rust commands return `Result<T, String>`; blocking work goes through `tauri::async_runtime::spawn_blocking`.
- Rust lint gate: `cargo clippy --all-targets --locked -- -D warnings` must pass.
- Frontend gates: `pnpm check-types`, `pnpm lint`, `pnpm test` must pass. `pnpm build` must stay within the CI startup bundle budget (`eager-budget.json`).

## File Structure

| Path | Responsibility | Status |
|---|---|---|
| `.github/workflows/release.yml` | Sign and upload `.rpm.sig` / `.deb.sig` | Modify |
| `src-tauri/Cargo.toml` | Add `minisign-verify` | Modify |
| `src-tauri/src/modules/updater/mod.rs` | Tauri commands, staging dir, path safety | Create |
| `src-tauri/src/modules/updater/package.rs` | Install-kind classification, install command | Create |
| `src-tauri/src/modules/updater/verify.rs` | Minisign verification | Create |
| `src-tauri/src/modules/mod.rs` | Register `updater` module | Modify |
| `src-tauri/src/lib.rs` | Register the four commands | Modify |
| `src/modules/updater/useUpdater.ts` | State machine, download, asset selection | Rewrite |
| `src/modules/updater/assets.ts` | Pure asset-selection helpers | Create |
| `src/modules/updater/assets.test.ts` | Asset-selection tests | Create |
| `src/modules/updater/index.ts` | Drop the dialog export | Modify |
| `src/settings/sections/AboutSection.tsx` | Inline update UI | Modify |
| `src/app/App.tsx` | Unmount `<UpdaterDialog />` | Modify |
| `src/modules/updater/UpdaterDialog.tsx` | — | **Delete** |
| `src/modules/updater/UpdaterDialogLazy.tsx` | — | **Delete** |

---

### Task 1: Publish `.rpm.sig` and `.deb.sig` from CI

`createUpdaterArtifacts` signs only updater-capable bundles — on Linux, the AppImage alone. `release.yml:126` re-signs just the AppImage. Nothing else is signed today, so there is nothing for the app to verify against. This task must land first.

**Files:**
- Modify: `.github/workflows/release.yml` (insert after the AppImage re-sign step, before `patch-appimage-updater`)

**Interfaces:**
- Consumes: nothing
- Produces: release assets `Terra-<version>-1.x86_64.rpm.sig` and `Terra_<version>_amd64.deb.sig`

- [ ] **Step 1: Add the signing step**

Insert into the `publish-tauri` job, immediately after the "Fix AppImage wayland libs and re-sign" step:

```yaml
      - name: Sign and upload rpm/deb for the in-app updater
        if: matrix.platform == 'ubuntu-22.04' && startsWith(github.ref, 'refs/tags/')
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          set -euo pipefail
          TAG="${GITHUB_REF_NAME}"

          for pkg in \
            src-tauri/target/release/bundle/rpm/*.rpm \
            src-tauri/target/release/bundle/deb/*.deb
          do
            test -e "$pkg" || { echo "missing bundle: $pkg"; exit 1; }
            rm -f "$pkg.sig"
            pnpm tauri signer sign "$pkg"
            test -s "$pkg.sig" || { echo "signing produced no .sig for $pkg"; exit 1; }
            gh release upload "$TAG" "$pkg" "$pkg.sig" \
              --clobber --repo "$GITHUB_REPOSITORY"
          done
```

- [ ] **Step 2: Verify the workflow still parses**

Run: `python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/release.yml')); print(list(d['jobs']['publish-tauri']['steps'][-1].keys()))"`
Expected: prints a list containing `name`, `if`, `env`, `run` — no YAML exception.

- [ ] **Step 3: Confirm the glob matches Tauri's real output paths**

Run: `grep -n "bundle/rpm\|bundle/deb\|bundle/appimage" .github/workflows/release.yml`
Expected: the existing AppImage step uses `src-tauri/target/release/bundle/appimage/*.AppImage`, confirming the sibling `bundle/rpm` and `bundle/deb` layout used above.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: sign and publish rpm/deb signatures for the in-app updater"
```

> **Note:** This step is only truly exercised on a real tag push. Do not claim it verified until a tagged release has produced both `.sig` assets.

---

### Task 2: Package classification and install command

**Files:**
- Create: `src-tauri/src/modules/updater/package.rs`
- Create: `src-tauri/src/modules/updater/mod.rs` (module declarations only in this task)
- Modify: `src-tauri/src/modules/mod.rs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `pub enum PackageKind { Rpm, Deb, Unsupported }` — derives `Debug, Clone, Copy, PartialEq, Eq, serde::Serialize`, serialized `rename_all = "lowercase"`
  - `pub fn classify(appimage: Option<&str>, pkexec: bool, rpm_owns: bool, dpkg_owns: bool) -> PackageKind`
  - `pub fn detect() -> PackageKind`
  - `pub fn install_command(kind: PackageKind, path: &std::path::Path) -> Option<(String, Vec<String>)>`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/modules/updater/package.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn appimage_is_unsupported_even_when_a_package_owns_the_binary() {
        // An AppImage extracted next to a distro install must never be
        // "upgraded" by handing the distro package manager a new file.
        assert_eq!(
            classify(Some("/home/u/Terra.AppImage"), true, true, false),
            PackageKind::Unsupported
        );
    }

    #[test]
    fn missing_pkexec_is_unsupported() {
        // Without a way to escalate there is no in-place install, so the UI
        // must fall back to the manual link rather than offering a download
        // it cannot finish.
        assert_eq!(classify(None, false, true, false), PackageKind::Unsupported);
    }

    #[test]
    fn rpm_ownership_wins() {
        assert_eq!(classify(None, true, true, false), PackageKind::Rpm);
    }

    #[test]
    fn dpkg_ownership_wins() {
        assert_eq!(classify(None, true, false, true), PackageKind::Deb);
    }

    #[test]
    fn rpm_takes_precedence_when_both_claim_the_binary() {
        // Some systems have both tools installed; rpm is probed first.
        assert_eq!(classify(None, true, true, true), PackageKind::Rpm);
    }

    #[test]
    fn unowned_binary_is_unsupported() {
        assert_eq!(classify(None, true, false, false), PackageKind::Unsupported);
    }

    #[test]
    fn rpm_install_uses_dnf_with_an_absolute_path() {
        let (bin, args) =
            install_command(PackageKind::Rpm, Path::new("/tmp/u/Terra.rpm")).unwrap();
        assert_eq!(bin, "pkexec");
        assert_eq!(args, vec!["dnf", "install", "-y", "/tmp/u/Terra.rpm"]);
    }

    #[test]
    fn deb_install_uses_apt_get_with_an_absolute_path() {
        let (bin, args) =
            install_command(PackageKind::Deb, Path::new("/tmp/u/Terra.deb")).unwrap();
        assert_eq!(bin, "pkexec");
        assert_eq!(args, vec!["apt-get", "install", "-y", "/tmp/u/Terra.deb"]);
    }

    #[test]
    fn unsupported_has_no_install_command() {
        assert!(install_command(PackageKind::Unsupported, Path::new("/tmp/x")).is_none());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib updater::package`
Expected: FAIL — `cannot find function classify`, `cannot find type PackageKind`.

- [ ] **Step 3: Implement**

Prepend to `src-tauri/src/modules/updater/package.rs`:

```rust
use std::path::Path;
use std::process::{Command, Stdio};

use crate::modules::proc::hide_console;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageKind {
    Rpm,
    Deb,
    Unsupported,
}

/// The decision, split out from the probing so it is testable without a real
/// install. `rpm` is checked before `dpkg` because a machine with both tools
/// installed is almost always an rpm distro that happens to ship dpkg.
///
/// A missing `pkexec` is reported as `Unsupported` here rather than failing at
/// install time, so the UI can offer the manual link instead of a download it
/// could never finish.
pub fn classify(
    appimage: Option<&str>,
    pkexec: bool,
    rpm_owns: bool,
    dpkg_owns: bool,
) -> PackageKind {
    if appimage.is_some() || !pkexec {
        return PackageKind::Unsupported;
    }
    if rpm_owns {
        return PackageKind::Rpm;
    }
    if dpkg_owns {
        return PackageKind::Deb;
    }
    PackageKind::Unsupported
}

/// Probes the environment and the running binary's ownership, then classifies.
pub fn detect() -> PackageKind {
    let appimage = std::env::var("APPIMAGE").ok();
    let exe = match std::env::current_exe().and_then(|p| p.canonicalize()) {
        Ok(p) => p,
        Err(_) => return PackageKind::Unsupported,
    };
    classify(
        appimage.as_deref(),
        which::which("pkexec").is_ok(),
        owns(&["rpm", "-qf"], &exe),
        owns(&["dpkg", "-S"], &exe),
    )
}

fn owns(argv: &[&str], exe: &Path) -> bool {
    let Some((bin, args)) = argv.split_first() else {
        return false;
    };
    if which::which(bin).is_err() {
        return false;
    }
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .arg(exe)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

/// `dnf`/`apt-get` rather than `rpm -U`/`dpkg -i`: the higher-level tools
/// resolve dependencies, which matters when a release bumps libwebkit2gtk.
pub fn install_command(kind: PackageKind, path: &Path) -> Option<(String, Vec<String>)> {
    let p = path.to_string_lossy().into_owned();
    let args = match kind {
        PackageKind::Rpm => vec!["dnf".into(), "install".into(), "-y".into(), p],
        PackageKind::Deb => vec!["apt-get".into(), "install".into(), "-y".into(), p],
        PackageKind::Unsupported => return None,
    };
    Some(("pkexec".into(), args))
}
```

Create `src-tauri/src/modules/updater/mod.rs`:

```rust
pub mod package;
```

Add to `src-tauri/src/modules/mod.rs`, keeping the list alphabetical (after `pub mod shell;`):

```rust
pub mod updater;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib updater::package`
Expected: PASS — 9 passed.

- [ ] **Step 5: Lint**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/updater/ src-tauri/src/modules/mod.rs
git commit -m "feat(updater): classify the install kind and build the install command"
```

---

### Task 3: Minisign verification

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/modules/updater/verify.rs`
- Modify: `src-tauri/src/modules/updater/mod.rs`

**Interfaces:**
- Consumes: nothing
- Produces: `pub fn verify(pubkey_field: &str, data: &[u8], signature: &str) -> Result<(), String>`
  - `pubkey_field` is the value straight out of `tauri.conf.json` — base64 of the full two-line minisign public key file
  - `signature` is the contents of a `.sig` file
  - Returns `Ok(())` only on a valid signature

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, in `[dependencies]` after `which = "8.0.4"`:

```toml
minisign-verify = "0.2"
```

Run: `cd src-tauri && cargo add minisign-verify@0.2 --offline 2>/dev/null || cargo fetch`
Expected: `Cargo.lock` updates. If the crate pulls more than one transitive dependency, stop and report — the spec justified this on the basis that it is dependency-light.

- [ ] **Step 2: Generate the test fixture**

The verifier cannot sign, so the test needs real key material. Generate a throwaway keypair — **never the production key in `~/.tauri/terra.key`**:

```bash
cd /tmp && rm -f fixture.key fixture.key.pub fixture.bin fixture.bin.sig
printf 'terra updater fixture\n' > fixture.bin
pnpm --dir "$OLDPWD" tauri signer generate -w /tmp/fixture.key -p "" --ci
pnpm --dir "$OLDPWD" tauri signer sign -f /tmp/fixture.key -p "" /tmp/fixture.bin
echo "--- PUBKEY (paste as FIXTURE_PUBKEY) ---"; cat /tmp/fixture.key.pub
echo "--- SIG (paste as FIXTURE_SIG) ---"; cat /tmp/fixture.bin.sig
```

Paste the two printed values into the constants at the top of the test below. `fixture.key.pub` is already base64 of the two-line key file, which is exactly the shape `tauri.conf.json` stores.

- [ ] **Step 3: Write the failing tests**

Create `src-tauri/src/modules/updater/verify.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Throwaway keypair generated for tests only — see the plan's Task 3.
    const FIXTURE_PUBKEY: &str = "<paste contents of /tmp/fixture.key.pub>";
    const FIXTURE_SIG: &str = "<paste contents of /tmp/fixture.bin.sig>";
    const FIXTURE_DATA: &[u8] = b"terra updater fixture\n";

    #[test]
    fn accepts_a_valid_signature() {
        assert!(verify(FIXTURE_PUBKEY, FIXTURE_DATA, FIXTURE_SIG).is_ok());
    }

    #[test]
    fn rejects_tampered_data() {
        let mut tampered = FIXTURE_DATA.to_vec();
        tampered[0] ^= 0x01;
        assert!(verify(FIXTURE_PUBKEY, &tampered, FIXTURE_SIG).is_err());
    }

    #[test]
    fn rejects_truncated_data() {
        assert!(verify(FIXTURE_PUBKEY, &FIXTURE_DATA[..4], FIXTURE_SIG).is_err());
    }

    #[test]
    fn rejects_a_malformed_signature() {
        assert!(verify(FIXTURE_PUBKEY, FIXTURE_DATA, "not a signature").is_err());
    }

    #[test]
    fn rejects_a_malformed_pubkey() {
        assert!(verify("!!!not base64!!!", FIXTURE_DATA, FIXTURE_SIG).is_err());
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib updater::verify`
Expected: FAIL — `cannot find function verify`.

- [ ] **Step 5: Implement**

Prepend to `src-tauri/src/modules/updater/verify.rs`:

```rust
use base64::Engine;
use minisign_verify::{PublicKey, Signature};

/// Verifies `data` against `signature` using the pubkey exactly as stored in
/// `tauri.conf.json` — base64 of the two-line minisign public key file.
pub fn verify(pubkey_field: &str, data: &[u8], signature: &str) -> Result<(), String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(pubkey_field.trim())
        .map_err(|e| format!("updater pubkey is not valid base64: {e}"))?;
    let text =
        String::from_utf8(decoded).map_err(|e| format!("updater pubkey is not utf-8: {e}"))?;

    let key = PublicKey::decode(&text).map_err(|e| format!("invalid updater pubkey: {e}"))?;
    let sig = Signature::decode(signature).map_err(|e| format!("invalid signature: {e}"))?;

    key.verify(data, &sig, false)
        .map_err(|e| format!("signature verification failed: {e}"))
}
```

Add to `src-tauri/src/modules/updater/mod.rs`:

```rust
pub mod verify;
```

`base64` may not yet be a direct dependency. Check first:

Run: `cd src-tauri && grep -n '^base64' Cargo.toml || cargo add base64@0.22`

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib updater::verify`
Expected: PASS — 5 passed.

If `PublicKey::decode` does not accept the two-line form, switch to taking the second line only:

```rust
let line = text
    .lines()
    .nth(1)
    .ok_or_else(|| "updater pubkey is missing its key line".to_string())?;
let key = PublicKey::from_base64(line).map_err(|e| format!("invalid updater pubkey: {e}"))?;
```

- [ ] **Step 7: Lint and commit**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: no warnings.

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/modules/updater/
git commit -m "feat(updater): verify minisign signatures against the configured pubkey"
```

---

### Task 4: Tauri commands, staging, and path safety

**Files:**
- Modify: `src-tauri/src/modules/updater/mod.rs`
- Modify: `src-tauri/src/lib.rs` (the `tauri::generate_handler!` list at `:242`)

**Interfaces:**
- Consumes: `package::{PackageKind, detect, install_command}`, `verify::verify`
- Produces four Tauri commands:
  - `updater_package_kind() -> Result<PackageKind, String>`
  - `updater_stage_begin(app: AppHandle, file_name: String, signature: String) -> Result<(), String>`
  - `updater_stage_finish(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String>` — returns the absolute staged path
  - `updater_install(app: AppHandle, file_name: String) -> Result<(), String>`
- Also produces `fn safe_staged_path(dir: &Path, file_name: &str) -> Result<PathBuf, String>`

**Why staging is split in two.** Tauri 2's `invoke` sends *either* a raw binary
body *or* JSON arguments — not both. A ~15 MB package must travel as a raw
body (`Array.from()` on 15 M bytes would allocate a JS array of ~120 MB), so
the metadata cannot ride along with it. `updater_stage_begin` takes the small
JSON args and writes `<file_name>.sig` into a freshly cleared staging dir;
`updater_stage_finish` then carries only the raw bytes and recovers the package
name from the single `.sig` file present. Staging is cleared on every `begin`,
so exactly one `.sig` is ever there.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/modules/updater/mod.rs`:

```rust
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
    fn staged_package_path_recovers_the_name_from_the_signature() {
        let dir = std::env::temp_dir().join(format!("terra-stage-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Terra-0.8.6-1.x86_64.rpm.sig"), b"sig").unwrap();

        assert_eq!(
            staged_package_path(&dir).unwrap(),
            dir.join("Terra-0.8.6-1.x86_64.rpm")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn staged_package_path_errors_when_nothing_is_staged() {
        let dir = std::env::temp_dir().join(format!("terra-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(staged_package_path(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib updater::tests`
Expected: FAIL — `cannot find function safe_staged_path`.

- [ ] **Step 3: Implement**

Replace the contents of `src-tauri/src/modules/updater/mod.rs` above the test module with:

```rust
pub mod package;
pub mod verify;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::{AppHandle, Manager};

use crate::modules::proc::hide_console;
use package::PackageKind;

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

/// The single staged package: the one `.sig` in the directory, minus `.sig`.
fn staged_package_path(dir: &Path) -> Result<PathBuf, String> {
    let mut found: Option<PathBuf> = None;
    for entry in fs::read_dir(dir).map_err(|e| format!("staging dir unreadable: {e}"))? {
        let path = entry.map_err(|e| format!("staging dir unreadable: {e}"))?.path();
        if path.extension().is_some_and(|e| e == "sig") {
            if found.is_some() {
                return Err("more than one staged update".to_string());
            }
            let s = path.to_string_lossy();
            found = Some(PathBuf::from(
                s.strip_suffix(".sig")
                    .ok_or_else(|| "malformed staged signature".to_string())?
                    .to_string(),
            ));
        }
    }
    found.ok_or_else(|| "no staged update — call updater_stage_begin first".to_string())
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

/// Clears staging and records the signature. Must precede
/// `updater_stage_finish`, which carries the package bytes as a raw body and
/// therefore cannot also carry metadata.
#[tauri::command]
pub async fn updater_stage_begin(
    app: AppHandle,
    file_name: String,
    signature: String,
) -> Result<(), String> {
    let dir = staging_dir(&app)?;
    // Validate before writing anything, so a hostile name never reaches disk.
    let path = safe_staged_path(&dir, &file_name)?;

    tauri::async_runtime::spawn_blocking(move || {
        clear_staging(&dir);
        fs::write(sig_path(&path), signature.as_bytes())
            .map_err(|e| format!("could not stage signature: {e}"))
    })
    .await
    .map_err(|e| format!("updater_stage_begin join: {e}"))?
}

/// Receives the package as a raw IPC body, verifies it against the signature
/// recorded by `updater_stage_begin`, and writes it only if it verifies.
#[tauri::command]
pub async fn updater_stage_finish(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        _ => return Err("updater_stage_finish expects a raw binary body".to_string()),
    };
    let dir = staging_dir(&app)?;
    let pubkey = configured_pubkey(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let path = staged_package_path(&dir)?;
        let signature = fs::read_to_string(sig_path(&path))
            .map_err(|e| format!("staged signature missing: {e}"))?;

        // Verify before the bytes ever land on disk, so a failed download
        // leaves nothing behind to install.
        verify::verify(&pubkey, &bytes, &signature)?;
        fs::write(&path, &bytes).map_err(|e| format!("could not stage update: {e}"))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("updater_stage_finish join: {e}"))?
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib updater`
Expected: PASS — 25 passed (9 package + 5 verify + 11 mod).

`package::detect()` now reports `Unsupported` when `pkexec` is absent, so
`install_command` is never reached without a way to escalate.

- [ ] **Step 5: Register the commands**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![` list (after the `git::commands::*` entries):

```rust
            updater::updater_package_kind,
            updater::updater_stage_begin,
            updater::updater_stage_finish,
            updater::updater_install,
```

Confirm `modules::updater` is in scope the same way sibling modules are — check the `use` block at the top of `lib.rs` and match it.

- [ ] **Step 6: Verify it compiles and lints**

Run: `cd src-tauri && cargo check --locked && cargo clippy --all-targets --locked -- -D warnings`
Expected: compiles, no warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/modules/updater/mod.rs src-tauri/src/lib.rs
git commit -m "feat(updater): stage, verify, and install packages behind pkexec"
```

---
### Task 4b: Refuse to install anything not strictly newer

Scoped down from an earlier draft. The Task 4 review raised a TOCTOU in the
user-writable staging directory and a webview-reachable rollback. Ruling: this
is a single-user personal tool, and both require an attacker already executing
code as that user, who has easier options than racing the updater. **The TOCTOU
is accepted as a known limitation and recorded in the spec. No symlink or
file-descriptor hardening is in scope.**

What remains is justified by an honest-path bug, not a threat model: `dnf
install -y` on an already-current package exits 0, so clicking install while
already up to date prompts for a password, installs nothing, reports success,
and relaunches. A strictly-newer check fixes that. Refusing downgrades is a
free side effect.

**Files:**
- Modify: `src-tauri/src/modules/updater/mod.rs`

**Interfaces:**
- Consumes: `package::PackageKind`
- Produces (private): `fn package_version(kind: PackageKind, path: &Path) -> Result<String, String>`, `fn is_newer(candidate: &str, current: &str) -> bool`
- `updater_install`'s public signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to the existing `mod tests` block in `src-tauri/src/modules/updater/mod.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib updater::tests`
Expected: FAIL — `cannot find function is_newer`.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/modules/updater/mod.rs`:

```rust
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
```

- [ ] **Step 4: Gate the install**

In `updater_install`, after the second `verify::verify(...)` call and before
building the install command, insert:

```rust
        let version = package_version(kind, &path)?;
        let current = env!("CARGO_PKG_VERSION");
        if !is_newer(&version, current) {
            return Err(format!(
                "refusing to install {version} over {current} — updates must move forward"
            ));
        }
```

`kind` is already computed by the existing `package::detect()` call; move that
call above this block if needed so both uses share it.

- [ ] **Step 5: Run tests and lint**

Run: `cd src-tauri && cargo test --lib updater && cargo clippy --all-targets --locked -- -D warnings`
Expected: PASS — 30 passed (9 package + 5 verify + 16 mod); clippy clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/updater/mod.rs
git commit -m "fix(updater): refuse to install a package that is not strictly newer"
```

---

### Task 5: Frontend asset selection

**Files:**
- Create: `src/modules/updater/assets.ts`
- Create: `src/modules/updater/assets.test.ts`

**Interfaces:**
- Consumes: `PackageKind` as the string union `"rpm" | "deb" | "unsupported"`
- Produces:
  - `export type PackageKind = "rpm" | "deb" | "unsupported"`
  - `export interface ReleaseAsset { name: string; browser_download_url: string }`
  - `export interface AssetPair { pkg: ReleaseAsset; sig: ReleaseAsset }`
  - `export function selectAsset(kind: PackageKind, assets: ReleaseAsset[]): AssetPair | null`
  - `export function isNewer(remote: string, current: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/updater/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isNewer, selectAsset, type ReleaseAsset } from "./assets";

const asset = (name: string): ReleaseAsset => ({
  name,
  browser_download_url: `https://example.test/${name}`,
});

const ASSETS = [
  asset("Terra_0.8.6_amd64.deb"),
  asset("Terra_0.8.6_amd64.deb.sig"),
  asset("Terra-0.8.6-1.x86_64.rpm"),
  asset("Terra-0.8.6-1.x86_64.rpm.sig"),
  asset("Terra_0.8.6_amd64.AppImage"),
  asset("Terra_0.8.6_amd64.AppImage.sig"),
  asset("latest.json"),
];

describe("selectAsset", () => {
  it("pairs the rpm with its signature", () => {
    const picked = selectAsset("rpm", ASSETS);
    expect(picked?.pkg.name).toBe("Terra-0.8.6-1.x86_64.rpm");
    expect(picked?.sig.name).toBe("Terra-0.8.6-1.x86_64.rpm.sig");
  });

  it("pairs the deb with its signature", () => {
    const picked = selectAsset("deb", ASSETS);
    expect(picked?.pkg.name).toBe("Terra_0.8.6_amd64.deb");
    expect(picked?.sig.name).toBe("Terra_0.8.6_amd64.deb.sig");
  });

  it("never selects the .sig as the package", () => {
    expect(selectAsset("rpm", ASSETS)?.pkg.name.endsWith(".sig")).toBe(false);
  });

  it("returns null for an unsupported install kind", () => {
    expect(selectAsset("unsupported", ASSETS)).toBeNull();
  });

  it("returns null when the signature is missing", () => {
    expect(selectAsset("rpm", [asset("Terra-0.8.6-1.x86_64.rpm")])).toBeNull();
  });

  it("returns null when no matching package exists", () => {
    expect(selectAsset("rpm", [asset("Terra_0.8.6_amd64.deb")])).toBeNull();
  });

  it("ignores non-x86_64 rpm builds", () => {
    expect(
      selectAsset("rpm", [
        asset("Terra-0.8.6-1.aarch64.rpm"),
        asset("Terra-0.8.6-1.aarch64.rpm.sig"),
      ]),
    ).toBeNull();
  });
});

describe("isNewer", () => {
  it("detects a newer patch", () => {
    expect(isNewer("0.8.6", "0.8.5")).toBe(true);
  });

  it("rejects an equal version", () => {
    expect(isNewer("0.8.5", "0.8.5")).toBe(false);
  });

  it("rejects an older version", () => {
    expect(isNewer("0.8.4", "0.8.5")).toBe(false);
  });

  it("strips a leading v", () => {
    expect(isNewer("v0.9.0", "0.8.5")).toBe(true);
  });

  it("compares numerically, not lexically", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
  });

  it("treats a prerelease as older than its release", () => {
    expect(isNewer("0.9.0-beta1", "0.9.0")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test assets`
Expected: FAIL — cannot resolve `./assets`.

- [ ] **Step 3: Implement**

Create `src/modules/updater/assets.ts`:

```ts
export type PackageKind = "rpm" | "deb" | "unsupported";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface AssetPair {
  pkg: ReleaseAsset;
  sig: ReleaseAsset;
}

/** release.yml builds Linux for x86_64 only; anything else stays manual. */
const SUFFIX: Record<Exclude<PackageKind, "unsupported">, string> = {
  rpm: ".x86_64.rpm",
  deb: "_amd64.deb",
};

export function selectAsset(
  kind: PackageKind,
  assets: ReleaseAsset[],
): AssetPair | null {
  if (kind === "unsupported") return null;
  const suffix = SUFFIX[kind];
  const pkg = assets.find((a) => a.name.endsWith(suffix));
  if (!pkg) return null;
  const sig = assets.find((a) => a.name === `${pkg.name}.sig`);
  if (!sig) return null;
  return { pkg, sig };
}

function parseVersion(v: string): { parts: number[]; prerelease: boolean } {
  const cleaned = v.replace(/^v/, "");
  const [core, ...rest] = cleaned.split("-");
  return {
    parts: core.split(".").map((p) => Number.parseInt(p, 10) || 0),
    prerelease: rest.length > 0,
  };
}

/**
 * A prerelease sorts below its own release, so 0.9.0-beta1 never counts as
 * newer than 0.9.0. This gates an automatic root install, so an over-eager
 * comparison is worse than a conservative one.
 */
export function isNewer(remote: string, current: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  const len = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < len; i++) {
    const x = a.parts[i] ?? 0;
    const y = b.parts[i] ?? 0;
    if (x !== y) return x > y;
  }
  if (a.prerelease !== b.prerelease) return b.prerelease;
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test assets`
Expected: PASS — 13 passed.

- [ ] **Step 5: Commit**

```bash
git add src/modules/updater/assets.ts src/modules/updater/assets.test.ts
git commit -m "feat(updater): select the release asset matching the install kind"
```

---

### Task 6: Rework the hook, rebuild the About panel, delete the modal

This is one task: the hook rewrite alone does not type-check, because
`AboutSection.tsx` and `App.tsx` still consume the old API. Splitting it would
produce a knowingly-broken commit and violate the Global Constraint that
`pnpm check-types` passes.

**Files:**
- Rewrite: `src/modules/updater/useUpdater.ts`
- Modify: `src/modules/updater/index.ts`
- Modify: `src/settings/sections/AboutSection.tsx`
- Modify: `src/app/App.tsx` (import near `:87`, `<UpdaterDialog />` near `:1248`)
- Delete: `src/modules/updater/UpdaterDialog.tsx`
- Delete: `src/modules/updater/UpdaterDialogLazy.tsx`

**Interfaces:**
- Consumes: `selectAsset`, `isNewer`, `PackageKind`, `AssetPair` from `./assets`; the three Tauri commands from Task 4
- Produces:
  - `export type UpdaterStatus` with `kind` in `idle | checking | uptodate | available | downloading | staged | installing | error`
  - `export function useUpdater(): { status, check, download, install, dismiss }`
  - No `autoCheck` option and no mount-time effect — the hook never touches the network unless `check()` is called

- [ ] **Step 1: Rewrite the hook**

Replace `src/modules/updater/useUpdater.ts` entirely:

```ts
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useState } from "react";
import { IS_LINUX } from "@/lib/platform";
import {
  isNewer,
  selectAsset,
  type AssetPair,
  type PackageKind,
  type ReleaseAsset,
} from "./assets";

const GITHUB_LATEST_RELEASE =
  "https://api.github.com/repos/kevsmir02/terra/releases/latest";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  releaseUrl: string;
  /** null when this install format cannot be updated in place. */
  pair: AssetPair | null;
}

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; info: AvailableUpdate }
  | {
      kind: "downloading";
      info: AvailableUpdate;
      downloaded: number;
      contentLength: number | null;
    }
  | { kind: "staged"; info: AvailableUpdate; fileName: string }
  | { kind: "installing"; info: AvailableUpdate }
  | { kind: "error"; message: string };

async function fetchLatest(): Promise<{
  version: string;
  currentVersion: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
} | null> {
  const [currentVersion, res] = await Promise.all([
    getVersion(),
    fetch(GITHUB_LATEST_RELEASE, {
      headers: { Accept: "application/vnd.github+json" },
    }),
  ]);
  if (res.status === 404) {
    throw new Error("No releases published yet.");
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`);
  }
  const data = (await res.json()) as {
    tag_name: string;
    html_url: string;
    assets?: ReleaseAsset[];
  };
  const version = data.tag_name.replace(/^v/, "");
  if (!isNewer(version, currentVersion)) return null;
  return {
    version,
    currentVersion,
    releaseUrl: data.html_url,
    assets: data.assets ?? [],
  };
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });

  const check = useCallback(async () => {
    setStatus({ kind: "checking" });
    try {
      const latest = await fetchLatest();
      if (!latest) {
        setStatus({ kind: "uptodate" });
        return;
      }
      let pair: AssetPair | null = null;
      if (IS_LINUX) {
        const kind = await invoke<PackageKind>("updater_package_kind");
        pair = selectAsset(kind, latest.assets);
      }
      setStatus({
        kind: "available",
        info: {
          version: latest.version,
          currentVersion: latest.currentVersion,
          releaseUrl: latest.releaseUrl,
          pair,
        },
      });
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, []);

  const download = useCallback(async () => {
    if (status.kind !== "available" || !status.info.pair) return;
    const { info } = status;
    const pair = info.pair;
    if (!pair) return;

    setStatus({ kind: "downloading", info, downloaded: 0, contentLength: null });
    try {
      const res = await fetch(pair.pkg.browser_download_url);
      if (!res.ok || !res.body) {
        throw new Error(`download failed (${res.status})`);
      }
      const contentLength = Number(res.headers.get("content-length")) || null;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let downloaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        downloaded += value.length;
        setStatus({ kind: "downloading", info, downloaded, contentLength });
      }
      const bytes = new Uint8Array(downloaded);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      const sigRes = await fetch(pair.sig.browser_download_url);
      if (!sigRes.ok) throw new Error(`signature download failed (${sigRes.status})`);
      const signature = await sigRes.text();

      // Two calls: Tauri sends either JSON args or a raw binary body, never
      // both. The metadata goes first; the package travels as a raw body so a
      // ~15 MB download is not re-encoded into a JS number array.
      await invoke("updater_stage_begin", {
        fileName: pair.pkg.name,
        signature,
      });
      await invoke<string>("updater_stage_finish", bytes);
      setStatus({ kind: "staged", info, fileName: pair.pkg.name });
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, [status]);

  const install = useCallback(async () => {
    if (status.kind !== "staged") return;
    const { info, fileName } = status;
    setStatus({ kind: "installing", info });
    try {
      await invoke("updater_install", { fileName });
      await relaunch();
    } catch (err) {
      const message = String(err);
      // A dismissed or refused polkit prompt keeps the staged package, so a
      // retry costs no re-download.
      setStatus(
        message.includes("cancelled") || message.includes("not authorized")
          ? { kind: "staged", info, fileName }
          : { kind: "error", message },
      );
    }
  }, [status]);

  const dismiss = useCallback(() => setStatus({ kind: "idle" }), []);

  return { status, check, download, install, dismiss };
}
```

- [ ] **Step 2: Drop the dialog export**

Replace `src/modules/updater/index.ts` with:

```ts
export { useUpdater } from "./useUpdater";
export type { AvailableUpdate, UpdaterStatus } from "./useUpdater";
```

- [ ] **Step 3: Delete the dialog and unmount it**

```bash
git rm src/modules/updater/UpdaterDialog.tsx src/modules/updater/UpdaterDialogLazy.tsx
```

In `src/app/App.tsx`, delete the `UpdaterDialog` import line and the `<UpdaterDialog />` element.

- [ ] **Step 4: Replace the update controls in AboutSection**

In `src/settings/sections/AboutSection.tsx`, replace the `useUpdater` destructure and the whole button block with:

```tsx
  const { status, check, download, install } = useUpdater();

  const busy =
    status.kind === "checking" ||
    status.kind === "downloading" ||
    status.kind === "installing";

  const primaryLabel =
    status.kind === "checking"
      ? "Checking…"
      : status.kind === "uptodate"
        ? "You're up to date"
        : status.kind === "available"
          ? status.info.pair
            ? `Download v${status.info.version}`
            : `v${status.info.version} available`
          : status.kind === "downloading"
            ? "Downloading…"
            : status.kind === "staged"
              ? "Restart to install"
              : status.kind === "installing"
                ? "Installing…"
                : status.kind === "error"
                  ? "Check failed — retry"
                  : "Check for updates";

  const onPrimary = () => {
    if (status.kind === "available" && status.info.pair) void download();
    else if (status.kind === "available") void openUrl(status.info.releaseUrl);
    else if (status.kind === "staged") void install();
    else void check();
  };

  const progress =
    status.kind === "downloading" && status.contentLength
      ? Math.min(100, Math.round((status.downloaded / status.contentLength) * 100))
      : null;
```

And in the JSX, replace the update `<Button>` with:

```tsx
          <Button size="sm" onClick={onPrimary} disabled={busy}>
            {primaryLabel}
          </Button>
```

Below the button row, replace the error/progress block with:

```tsx
        {status.kind === "error" && (
          <p className="font-mono text-[10.5px] break-all text-destructive/80">
            {status.message}
          </p>
        )}
        {status.kind === "available" && !status.info.pair && (
          <p className="text-[11px] text-muted-foreground">
            This install format updates manually — the button opens the release
            page.
          </p>
        )}
        {progress !== null && (
          <p className="text-[11px] text-muted-foreground">{progress}%</p>
        )}
```

- [ ] **Step 5: Verify types, lint, and tests**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: all pass. `check-types` exits 0; `pnpm test` reports 55+ files passing.

- [ ] **Step 6: Verify the bundle budget and dead-code gates**

Run: `pnpm build && pnpm knip`
Expected: build succeeds within `eager-budget.json`; `knip` reports no newly unused files or exports. Deleting the lazy dialog removes a chunk, so the eager set should shrink or stay flat — if the budget script errors on a missing chunk name, update `eager-budget.json` to match the new output and say so in the commit.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(updater): drive updates from the About panel and drop the modal"
```

---

### Task 7: Manual verification against a real release

Automated tests cannot cover `pkexec` + `dnf`/`apt` — that needs root and a genuinely signed package. This task is performed by hand and its result reported honestly.

**Files:** none

- [ ] **Step 1: Cut a release**

```bash
git tag v0.8.6 && git push origin v0.8.6
```

Wait for `release.yml`. Confirm the release carries `Terra-0.8.6-1.x86_64.rpm`, `Terra-0.8.6-1.x86_64.rpm.sig`, `Terra_0.8.6_amd64.deb`, and `Terra_0.8.6_amd64.deb.sig`.

- [ ] **Step 2: Install the baseline by hand**

Install the 0.8.6 rpm manually. This build carries the new pubkey — auto-update cannot bridge its own key rotation, so this one install must be manual.

- [ ] **Step 3: Cut v0.8.7 and exercise the flow**

From the installed 0.8.6, open Settings → About and click through: check → `Download v0.8.7` → progress → `Restart to install` → polkit prompt → app relaunches on 0.8.7.

Confirm each of these by observation:
- No network request occurs at launch (no check until the button is pressed)
- No modal appears at any point
- Cancelling the polkit prompt returns to `Restart to install` and retrying does **not** re-download
- `~/.cache/app.kevsmir02.terra/updates/` is empty after a successful install

- [ ] **Step 4: Verify tamper rejection**

With a staged package present, corrupt it and confirm the install refuses:

```bash
STAGE=~/.cache/app.kevsmir02.terra/updates
printf 'x' >> "$STAGE"/*.rpm
```

Click `Restart to install`. Expected: an error, **no polkit prompt**, and no installation.

- [ ] **Step 5: Record the outcome**

Report exactly which steps were observed to pass. Do not describe the privileged path as verified on the strength of the unit suite.
