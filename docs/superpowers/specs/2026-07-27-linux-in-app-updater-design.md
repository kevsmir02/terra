# Design: Opt-In In-App Updater for Linux (RPM/DEB)

**Date:** 2026-07-27
**Status:** Approved (brainstorming complete, pending implementation plan)

## Goal

Give Linux users a real in-app update path — check, download, verify, install,
restart — instead of today's "here is a shell command, go do it yourself"
handoff. The flow is strictly opt-in: nothing contacts the network unless the
user clicks **Check for updates** in the About panel, and no dialog ever
interrupts a session.

Target flow:

```
[Check for updates]
      |
      +-- no update --> "You're up to date"
      |
      +-- update -----> [Download update] --> progress --> [Restart to install]
                                                                  |
                                                          polkit password dialog
                                                                  |
                                                          install, then relaunch
```

## Decisions (from brainstorming)

1. **Privilege escalation: `pkexec` (graphical polkit dialog).** The desktop's
   native password dialog, the same mechanism GNOME Software uses. No terminal
   involved, works when Terra is launched from a menu. Requires a running
   polkit agent, so absence is detected up front and degrades to a manual
   download link.

2. **Formats: RPM and DEB.** AppImage self-update is a genuinely different code
   path (no sudo, in-place file swap, FUSE and in-use-binary failure modes) and
   is out of scope; AppImage keeps the manual "open the release page" flow.
   x86_64 only, because `release.yml` builds no other Linux architecture.

3. **No automatic check on any platform.** The startup check and the modal are
   removed outright — `UpdaterDialog` is deleted and unmounted from `App.tsx`.
   macOS and Windows also become manual-only. This keeps one mental model
   across platforms, removes a launch-time network call, and fits the project's
   no-telemetry stance.

4. **Verify the minisign signature before escalating.** The app downloads a
   package and hands it to `dnf`/`apt` as root; TLS alone is not an adequate
   basis for that. Adds one small pure-Rust dependency, `minisign-verify`.

5. **Download in the frontend, verify and install in Rust.** The AI purge
   removed `reqwest`, `tokio`, `bytes`, and `futures-util` — there is no HTTP
   client left in Rust, and re-adding a TLS stack to fetch one file a month
   contradicts the project's dependency discipline and CI bundle budget. The
   webview already has `connect-src https:` in its CSP, which is how
   `checkLinuxRelease` reaches the GitHub API today.

## Prerequisite: CI must publish `.rpm.sig` and `.deb.sig`

`createUpdaterArtifacts` signs only *updater-capable* bundles. On Linux that is
the AppImage alone, and `release.yml:126` confirms it — the re-sign step runs
`pnpm tauri signer sign "$APPIMAGE"` and nothing else. **No `.rpm.sig` or
`.deb.sig` is published today.**

Since signature verification is the entire basis for trusting a root install,
`release.yml` gains a step that signs both packages with `tauri signer sign`
and uploads the `.sig` files to the release. **This feature cannot ship without
that step.**

## Architecture

### Rust: `src-tauri/src/modules/updater/`

Three files, mirroring the layout of the existing `device/` module.

| File | Responsibility | Pure? |
|---|---|---|
| `package.rs` | Classify install kind; build the install command | Yes |
| `verify.rs` | Minisign signature verification | Yes |
| `mod.rs` | Tauri commands, orchestration, path safety | No |

#### `updater_package_kind() -> PackageKind`

Returns `Rpm`, `Deb`, or `Unsupported`.

Probing: `$APPIMAGE` present means `Unsupported`; otherwise resolve
`std::env::current_exe()` and probe ownership with `rpm -qf <exe>`, then
`dpkg -S <exe>`.

The *probe* is separated from the *decision* so the decision is unit-testable:

```rust
fn classify(appimage: Option<&str>, rpm_owns: bool, dpkg_owns: bool) -> PackageKind
```

#### `updater_stage(bytes, signature, file_name) -> StagedUpdate`

Writes bytes to `app_cache_dir()/updates/<file_name>`, verifies the signature,
and **deletes the file if verification fails** so a tampered or corrupt
download never lingers on disk.

Staging directory lifecycle: `updater_stage` clears any existing contents
before writing, so at most one staged package exists at a time and an abandoned
download from a previous session cannot be installed by accident. The directory
is cleared again immediately before `relaunch()` on a successful install.

#### `updater_install(file_name)`

Re-verifies, then runs one of:

- `pkexec dnf install -y <path>`
- `pkexec apt-get install -y <path>`

`dnf`/`apt-get` rather than `rpm -U`/`dpkg -i`, because the higher-level tools
resolve dependencies — which matters when a release bumps `libwebkit2gtk`.

### Two safety properties

These are the difference between a safe feature and a local root exploit:

1. **`file_name` is a bare filename, not a path.** Any value containing a path
   separator or `..` is rejected; the name is joined to the staging directory
   on the Rust side. Without this, a compromised webview could ask Rust to
   `pkexec`-install an arbitrary file.

2. **The signature is re-verified inside `updater_install`.** Verifying only at
   stage time leaves a TOCTOU window in which the staged file could be swapped
   between download and the privileged call. Re-verification costs milliseconds.

The public key is read at runtime from `app.config().plugins.updater.pubkey`
rather than duplicated in a constant, keeping one source of truth with what
macOS and Windows already validate against.

### Frontend

`useUpdater.ts` drops its startup `useEffect` and gains explicit states:

```
idle -> checking -> uptodate
                 -> available -> downloading -> staged -> installing -> (relaunch)
                 -> error
```

`download()` streams the asset through a `ReadableStream` reader for accurate
progress, then passes the bytes to `updater_stage`. `install()` calls
`updater_install` and then `relaunch()`.

Asset selection matches the detected `PackageKind` against the release's
`assets[]` by suffix, pairing each package with its `.sig`.

### Deletions

- `src/modules/updater/UpdaterDialog.tsx`
- `src/modules/updater/UpdaterDialogLazy.tsx`
- The `<UpdaterDialog />` mount and import in `src/app/App.tsx`
- The corresponding export in `src/modules/updater/index.ts`

This also removes the stale `yay -S terra-bin` command (an AUR package that does
not exist for this fork) and the distro picker, closing that loose end.

### About panel

All state renders inline, replacing the single button:

| State | UI |
|---|---|
| `idle` | `Check for updates` |
| `checking` | `Checking…` (disabled) |
| `uptodate` | `You're up to date` |
| `available` | `v0.8.6 available` + `Download update` |
| `downloading` | Progress bar with percentage |
| `staged` | `Restart to install` |
| `installing` | `Installing…` (polkit dialog is up) |
| `error` | Message with retry |

## Error handling

| Condition | Behavior |
|---|---|
| `pkexec` missing / no polkit agent | Detected before offering install; show manual download link |
| User cancels polkit (exit 126) | Return to `staged`, **keep the staged file** so retry costs no re-download |
| Not authorized (exit 127) | Surface as auth failure, stay `staged` |
| `dnf`/`apt` failure | Show trailing stderr, stay `staged` |
| Signature mismatch | Hard stop; staged file deleted; never escalates |
| Download interrupted | Discard partial file, return to `available` |
| No releases published (404) | "No releases published yet" instead of the raw `GitHub API 404` |

## Testing

Unit-tested (no root, no network):

- `classify()` across every input combination
- Install-command construction per `PackageKind`
- Signature verify/reject using a generated keypair fixture: sign known bytes
  and assert acceptance; flip one byte and assert rejection
- Path-traversal rejection — `updater_install("../../etc/passwd")` must fail

Frontend (vitest, `invoke` and `fetch` mocked):

- Asset selection per package kind
- Version comparison
- Progress accumulation and state transitions

**Not covered by automated tests:** actual `pkexec` + `dnf`/`apt` execution,
which requires root and a real signed package. This is a manual verification
step performed against a real release, and must not be reported as passing on
the strength of the unit suite.

## Out of scope

- AppImage self-update
- Non-x86_64 Linux architectures
- GPG-signing packages for native `dnf`/`apt` verification
- Any automatic or background update check
- Changes to macOS/Windows install mechanics beyond removing the auto-check

## Accepted limitations

- **Staging-directory TOCTOU.** The staged package is handed to the privileged
  installer by path, from a user-writable directory (`app_cache_dir()/updates`).
  A process running as the same user could swap that file, or plant a symlink,
  between verification and install, and get unverified content installed as
  root. Closing this properly needs a file-descriptor handoff or root-owned
  staging. Accepted: this is a single-user personal tool, and the attack
  requires an adversary already executing code as that user, who has cheaper
  routes than racing the updater. Revisit if Terra ever ships to others.
- **Signatures bind content, not versions.** Minisign proves a package came
  from the project's key; it says nothing about which release it is. The
  strictly-newer check in `updater_install` reads the version from the package
  metadata to compensate, but the primary reason that check exists is that
  `dnf install -y` exits 0 on an already-current package.
