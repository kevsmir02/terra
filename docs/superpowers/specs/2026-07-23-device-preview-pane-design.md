# Design: Device Preview Pane — ADB/scrcpy Stream Docking

**Date:** 2026-07-23
**Status:** Approved (brainstorming complete, pending implementation plan)

## Goal

Add a **`DevicePreviewTab`** to Terra: a pane that renders the live display of an
already-running Android device (system emulator AVD like `emulator-5554`, or a
physical Android device over USB) directly inside the Terra window — the mobile
counterpart of the existing web `PreviewPane`. This eliminates the Alt-Tab pain of
a floating external emulator window during mobile development (React Native,
Flutter, Expo, Android CLI workflows).

Terra does **not** build, run, or bundle an Android emulator. It mirrors the
display stream of a device the user is already running, exactly the way the web
preview pane mirrors a localhost dev server.

## Decision context (scope)

`ROADMAP.md` lists "Heavy IDE features" and "tools that pull the product away from
the terminal-first surface" as out of scope. A **Device Preview pane** is in scope
because it is the mobile analog of the existing web `PreviewPane` ("stays scoped
to local dev servers and lightweight doc viewing"): a render surface for
already-running local targets, not an emulator or device debugger. ROADMAP's
Planned section already carries an **"Embedded Android Device Preview"** entry
("Dock and render running system Android emulator/AVD displays directly inside a
Terra panel without bundling an emulator.") — that's the canonical name for this
feature. When this ships, move that entry from Planned → Shipped alongside the
existing web preview item, and widen the still-unplanned "Smart Dev Server
Auto-Docking" item to also cover PTY-sniff-driven auto-open of device preview
tabs (out of scope for this spec; tracked separately).

## Decisions (from brainstorming)

1. **Approach B only. scrcpy is the ADB display path; native window reparenting is
   rejected.** Tauri 2 exposes no foreign-window-host API (docs cover only
   `WebviewWindow` creation for Terra's own windows), so a reparented emulator
   window would be a sibling native OS window parked over a pane region — never a
   DOM pane. It would not move, clip, or tab with Terra. On Wayland it cannot be
   implemented at all (no API exists — Wayland's security model forbids cross-client
   reparenting). ADB/scrcpy streams bytes into a DOM `<video>` on every platform
   through one code path; that matches Terra's existing thin-Rust, external-CLI
   pattern (git, adb, emulator already treated as external).

2. **Bundle `scrcpy-server.jar` as a Tauri resource, not a `scrcpy` host binary.**
   Terra never spawns the user's `scrcpy`. Terra pushes the bundled
   `scrcpy-server-<version>.jar` to the device with `adb push`, forwards a TCP port
   with `adb forward`, and runs it via `adb shell CLASSPATH=... app_process`. This
   is the scrcpy "standalone server" pattern from `doc/develop.md`. The JAR
   (~100 KB, Apache-2.0, matches Terra's license) runs on the *device*, not the
   host, so it is cross-platform-agnostic and fits the 7-8 MB bundle budget. The
   only host dependency Terra requires is `adb` itself — already in every Android
   developer's PATH and a strictly smaller ask than scrcpy.

3. **`ws-scrcpy` is the reference, not a dependency.** Terra borrows `ws-scrcpy`'s
   MSE-`<video>` decoder pattern and its binary control-protocol message classes
   (`TouchControlMessage`, `KeyCodeControlMessage`) as the implementation
   reference. We do not import the `ws-scrcpy` package — we port the small amount of
   decoder-feeding and message-serialization logic we need into Terra's own
   `src/modules/device/` module, in Terra's style.

4. **Input via scrcpy's binary control protocol; `adb shell input` is the
   runtime auto-fallback, not an implementation-time choice.** The control
   protocol is the path of record: pointer/keyboard events become
   `TouchControlMessage`/`KeyCodeControlMessage` frames written to scrcpy's
   control socket — multi-touch, drags, pinch, keyboard, sub-50ms latency. The
   `adb shell input tap / swipe / keyevent` fallback fires *at runtime* per
   session only when the control socket is closed/malformed/unexpected-version
   (single-touch, ~50-100ms per event, no gesture composition). It is never
   chosen at implementation time as "ship the simple one" — see Input Bridge.

5. **Hard YAGNI guards for v1:**
   - One device per pane. Device switching is a dropdown, not multi-pane.
   - No audio (`audio=false`). Devs watch device state, not listen.
   - No recording, screenshot, or file transfer — those live in the terminal via
     `adb pull/screencap` and friends (roadmap: "Use `npm`, `pip`, `cargo` and
     friends in the terminal directly" applies to `adb` too).
   - No auto-detect-and-open of device tabs in v1. Detection dropdown only; the
     "sniff PTY for `adb install`/`emulator-XXXX` → auto-open device tab" behavior
     is folded into the existing planned "Smart Dev Server Auto-Docking" roadmap
     item, not this spec.
   - No physical-device-specific config (USB vendor filtering, wifi pairing). If
     `adb devices` sees it, it's in the dropdown.

## Architecture & Boundary

### Add

**Tauri resource bundle (`src-tauri/tauri.conf.json`, `src-tauri/resources/`):**
- `src-tauri/resources/scrcpy-server-<version>.jar` — committed JAR (~100 KB).
  License notice: `scrcpy` is Apache-2.0; record attribution in `LICENSE` /
  `THIRD_PARTY` (scrcpy already lists its own third-party notices inside the
  binary; surface the project URL `https://github.com/Genymobile/scrcpy` in the
  About panel alongside other bundled dependencies).
- `tauri.conf.json`: add `"resources": ["resources/scrcpy-server-*.jar"]`.
  Resolved at runtime via
  `app.path().resolve("scrcpy-server-<version>.jar", BaseDirectory::Resource)`.

**Backend (`src-tauri/src/modules/device/` — new module):**
- `mod.rs` — module entry, Tauri command registration in `src-tauri/src/lib.rs`
  alongside `pty::`, `git::`, `lsp::`.
- `adb.rs` — thin `adb` host: `adb_path() -> Result<PathBuf>` (PATH lookup,
  same pattern as `git::process::git_path`), `list_devices()` (parses
  `adb devices -l`), `execute_server(plan)` (the push + forward + app_process
  sequence).
- `session.rs` — one `DeviceSession` per active preview tab:
  - Fields: `device_serial`, `local_port`, `server_child: tokio::process::Child`,
    `video_socket`, `control_socket: Option<TcpStream>`, `frame_rx`.
  - Lifecycle: spawn on tab-open, terminate on tab-close (mirrors the lazy
    ref-counted lifecycle of `lsp::session` — spawn while a tab consumes the
    device, kill the server child when the last consumer closes).
  - Reads raw H.264 Annex-B NAL units off the forwarded TCP socket; emits
    `DeviceFrame` events to the frontend via a Tauri `Channel<Uint8Array>`.
- `remux.rs` — wraps Annex-B NAL units into fragmented MP4 (fMP4) init segment +
  media segments. Implement against a single, pinned scrcpy server version, so
    the demuxer/parser stays version-coupled and trivial. ~50-150 LOC.
- `control.rs` — writes binary `TouchControlMessage`/`KeyCodeControlMessage`
  frames to scrcpy's control socket. Port the message-format constants from
  `ws-scrcpy`'s `ControlMessage` classes (not a dependency — copied, in Terra
  style, with a `// ported from ws-scrcpy (Apache-2.0)` header).
- `commands.rs` — `#[tauri::command]` layer: `device_list`, `device_open(serial,
  on_frame: Channel) -> DeviceHandle`, `device_send_control(handle, msg)`,
  `device_close(handle)`. Bound to capabilities in
  `src-tauri/capabilities/default.json`.

**Frontend (`src/modules/device/` — new module, shadow of `src/modules/preview/`):**
- `DevicePreviewPane.tsx` — host the `<video>` element + MSE `SourceBuffer`,
  owned by a `DevicePreviewTab`. Mirrors the lifecycle shape of
  `preview/PreviewPane.tsx` (forwardRef handle for `reload`/`focus`).
- `MsePlayer.ts` — minimal port of `ws-scrcpy`'s `MsePlayer.pushData(frameData)`
  pattern: append NAL/segment bytes to a `SourceBuffer` once `MediaSource`
  `sourceopen` fires. Codec-string handling pinned to `video/mp4;
  codecs="avc1.<profile>.<level>"` decoded from the SPS of the first NAL.
- `DeviceDropdown.tsx` — dropdown of `adb devices -l` results; "Refresh"
  re-polls. Empty states handled in `DevicePreviewPane` (see Empty States).
- `controlBridge.ts` — canvas pointer/keyboard events → `ControlMessage`
  binary frames → `invoke('device_send_control', {handle, msg})`. Coordinate
  mapping (canvas → device-resolution) reuses the size-ratio pattern from
  `ws-scrcpy`'s `Position`/`Point`/`Size`.
- `DeviceStack.tsx` — parallel of `preview/PreviewStack.tsx` + `MarkdownStack.tsx`
  for multi-tab render mirroring.
- `index.ts` — exports.

**Cross-module wiring:**
- `src/modules/tabs/` — new `DevicePreviewTab` kind: `{ kind: "device-preview",
  serial: string }`. Added to the `Tab` union alongside `terminal` / `editor` /
  `preview` / `markdown` / `git-history`. `useTabs.ts` open/close hooks spawn /
  release the device session (mirrors LSP `handle.release()` pattern in
  `useLspExtension.ts:43`).
- `src/modules/sidebar/` — "Devices" activity-bar entry, parallel to
  "Explorer"/"Source Control"/"Git History". The session list / dropdown lives
  in this sidebar panel; double-clicking a device opens a `DevicePreviewTab`.

### Reuse

- `PreviewPane.tsx`'s forwardRef handle shape (`reload`/`focus`).
- `EditorPane.tsx`/`Sources` pane vis-tabs rendering pattern (`MarkdownStack.tsx`).
- `lsp::session`'s ref-counted spawn-on-consume / kill-on-idle lifecycle.
- `LspServersGroup.tsx`'s "detected vs not-found-on-PATH" empty-state pattern.
- `useTerminalFileDrop.ts`'s coordinate→pane mapping (canvas coordinate
  resolution).

### Out of scope (YAGNI guards recapped)

- The `scrcpy` host binary: Terra never spawns it; only `adb` + the bundled JAR.
- Multi-device simultaneous panes.
- Audio, recording, screenshot, file transfer.
- PTY-sniff-driven auto-open (planned-roadmap item, tracked separately).
- USB/wifi device pairing config in Terra (do it in `adb` via the terminal).
- iOS / non-ADB mirrors. (ws-scrcpy supports iOS but Terra's audience is Android
  mobile-dev; add iOS only if a user asks.)
- A bundled `adb`. Larger than the size budget warrants; ubiquitous among target
  users.

## Data Flow & Lifecycle

```
[ DevicePreviewTab opened ]
        |
        v
[ src-tauri/modules/device/adb.rs ]
   adb devices -l  ->  adb::list_devices()
   user picks serial via DeviceDropdown
        |
        v
[ src-tauri/modules/device/session.rs ]   (pseudocode: real topology is
   pinned to the bundled scrcpy-server version; see "Version pinning")
   1. adb push scrcpy-server-${SERVER_VERSION}.jar /data/local/tmp/terax-scrcpy.jar
   2. adb forward tcp:${LOCAL_PORT} localabstract:terax-scrcpy
      (with a second forward for control if the pinned server protocol
       uses a separate control socket; some scrcpy versions multiplex
       control bytes onto the same socket — the implementation plan pins
       this against the bundled JAR's documented protocol)
   3. adb shell CLASSPATH=/data/local/tmp/terax-scrcpy.jar \
          app_process / com.genymobile.scrcpy.Server ${SERVER_VERSION} \
          tunnel_forward=true audio=false control=true \
          raw_stream=true max_size=1920 max_fps=30
   4. connect TcpStream(s) to 127.0.0.1:${LOCAL_PORT}[/+1]
      (binding 127.0.0.1 only; adb's behavior, not configurable)
        |
        v
[ src-tauri/modules/device/remux.rs ]
   Parse Annex-B NAL units (00 00 00 01 / 00 00 01 start codes)
   Build fMP4 ftyp+styp+moof+mdat segments
   -> Channel<DeviceFrame> events to frontend
        |
        v
[ src/modules/device/MsePlayer.ts ]
   MediaSource + SourceBuffer{mode:'segments', codecs: avc1.<detected>}
   video.play()  (decoded by browser's HW H.264 path)
        |
        v
[ <video> in DevicePreviewPane.tsx ] <-- user clicks/drags/types
        |
        v
[ src/modules/device/controlBridge.ts ]
   pointer coords -> device-resolution coords (canvas W x H -> device W x H)
   pointerdown -> TouchControlMessage{action:DOWN, pointerId, point, pressure}
   pointermove -> TouchControlMessage{action:MOVE, ...}
   pointerup   -> TouchControlMessage{action:UP,   ...}
   keydown     -> KeyCodeControlMessage{action:DOWN, keycode, metaState}
        |
        v
[ invoke('device_send_control', {handle, msg}) ]
        |
        v
[ src-tauri/modules/device/control.rs ]
   Write ControlMessage binary frame to control socket
   -> scrcpy server injects into the device InputManager

[ DevicePreviewTab closed ]
   useTabs close hook -> DeviceHandle.release()
   -> DeviceSession::drop -> kill server child, close sockets
   (Compatible with Terra's app-close guards in useTabCloseGuards.ts:35.)
```

## Bundling: `scrcpy-server.jar` as a Tauri Resource

`scrcpy` is two parts: a host binary (`scrcpy`) that opens a window, and
`scrcpy-server.jar` that runs *on the device* via `app_process`. Terra bundles
only the JAR and runs the standalone-server pattern directly through `adb`. The
host binary is never invoked.

**Why "resource" not "sidecar":** In Tauri 2, `bundle.externalBin` (sidecar) is
for platform-specific executables shipped alongside the app. A JAR is
platform-agnostic data, belongs in `bundle.resources`, and resolves at runtime
via `BaseDirectory::Resource`. Calling it a "sidecar" in this doc or in the code
is wrong and will mislead future maintainers.

**Version pinning:** Pin to one stable scrcpy server version per Terra release.
The JAR, the H.264 demuxer in `remux.rs`, and the control-protocol constants in
`control.rs` ship together — there is no "detect the user's scrcpy version"
double-maintenance path. Bump the triad as one in the same Terra release. This is
a simplification over the "use whatever the user installed" alternative, not an
added cost.

**License & attribution:** `scrcpy` is Apache-2.0 (matches `tauri.conf.json`
`bundle.license: "Apache-2.0"`). Bundle is license-compatible. Add scrcpy's
project URL and license reference to the About panel alongside other bundled
dependencies; keep the existing THIRD-party attribution pattern consistent with
how `portable-pty`, `xterm.js`, and CodeMirror are attributed.

**Size:** ~100 KB. ROADMAP targets 7-8 MB; the JAR is negligible.

**Update cadence:** When a scrcpy server update adds a feature Terra needs (new
codec support, lower-latency control protocol), bump all three version-coupled
files in one Terra release. Ship notes mention the bundled scrcpy-server version.

## Input Bridge: scrcpy Control Protocol

`ws-scrcpy`'s `TouchControlMessage`/`KeyCodeControlMessage` are binary frames
matching scrcpy's control protocol (`doc/develop.md`), each ≤ ~25 bytes. Tap,
drag, pinch, and keyboard work natively through scrcpy's `InputManager` with
sub-50ms latency. ws-scrcpy's reference TypeScript implementations are the port
target; the binary layout (`writeInt8`/`writeInt32BE` offsets) is documented in
the `ws-scrcpy` source as referenced in the audit.

**Fallback (auto, not user-facing):** the control protocol is the path of record.
`control.rs` attempts the binary-frame write; on a closed/malformed/unexpected-
version control socket it transparently degrades per session to `adb shell input
tap <x> <y>` / `adb shell input swipe <x1 y1 x2 y2>` / `adb shell input keyevent
<key>`. Single-touch only, ~50-100ms per event, no pinch/drag-composition. There
is no user-facing toggle: fallback fires when the control socket is unusable, not
on a config switch. If the implementation finds the control socket path reliable
across all tested devices/emulators, the `adb shell input` branch becomes dead
code that can be deleted in a follow-up — recorded here, not silently dropped.

## Empty States & Error Handling

`DevicePreviewPane` surfaces four states. All mirror the existing
`LspServersGroup.tsx` "detected vs not-found" pattern (one-line status, not a
modal):

1. **`adb` not on PATH.** "adb not found — install Android Platform Tools
   (`sudo apt install adb`, `brew install android-platform-tools`,
   `winget install Google.PlatformTools`). Terra shells out to it; Terra does
   not bundle it."
2. **No devices.** "No devices. Plug in a device or start an emulator
   (`emulator -avd Pixel_API34`). Use 'Refresh' to re-poll."
3. **Device seen but server failed to start.** "Device preview failed to start.
   Open the Tauri console for the adb error. Possibly unsupported Android version
   for the bundled scrcpy server; try a newer Android image or check the JAR
   version in About."
4. **`adb devices -l` returns an `unauthorized` device.** "Device is
   unauthorized — accept the USB debugging prompt on the device, then 'Refresh'."

No silent failure. The pane always renders a state, never a blank box — matches
`PreviewPane.tsx`'s `EmptyState`/`SuspendedState` pattern.

## Wayland & Linux Consideration

Wayland's security model exposes no protocol for a client to enumerate, query, or
reparent another client's window — that is foundational, not incremental. The
approach rejected here (native window reparenting) is therefore *unimplementable*
on Wayland, not merely fragile. The chosen approach (ADB byte stream into a DOM
`<video>`) never touches the window system: the device is captured via ADB
(USB or `adb connect` TCP), the resulting H.264 stream is bytes in a socket, the
browser's MSE decoder renders the frames. Every OS step is bypassed. Terra on
Wayland, X11, Windows, and macOS behaves identically; this identity is the
origin of "Approach B is cross-platform-resilient" — it is not a property we add,
it is a property we get for free by never reaching for the window manager.

Wayland-specific: none. The only "Wayland tax" is shared by every platform —
buffered-video MSE latency (~30-80ms on top of scrcpy's ~30-70ms). For
app-development preview that is acceptable (devs watch device state, not
twitch-input games). If it ever bites: ship WebCodecs as a second decode path
(`ws-scrcpy` has it ready as a reference) — drops the MSE buffer and roughly
halves end-to-end latency. Recorded in this spec as a "if needed" lever, not a
v1 deliverable.

## Security Considerations

- **Rust backend owns all OS access.** Terra's existing rule (webview never
  touches FS/processes/shells; everything via `invoke()`) applies. `adb` is
  invoked only from `src-tauri/src/modules/device/adb.rs`.
- **The scrcpy-server JAR runs on the user's own dev device**, under their own
  `adb`, in their own workflow — same trust boundary as `adb` itself. Terra does
  not push the JAR to devices it has not been asked to preview.
- **No writable TCP listener on the host.** `adb forward` binds `127.0.0.1:port`
  only (adb's behavior); external hosts cannot reach the forwarded sockets.
- **Empty state before first device:** no surprising auto-connect. The user picks
  a device from the dropdown; no implicit device auto-discovery-and-launch on
  app boot.

## Testing & Verification

1. `pnpm check-types` — TypeScript passes.
2. `pnpm lint` — Biome linter passes.
3. `pnpm test` — Vitest passes. Cover the pure demux/serialize logic:
   `remux.rs` Annex-B→fMP4 NAL parsing (single-threaded, no Tauri needed) gets a
   Rust unit test with a captured Annex-B fixture; `control.rs`'s message encode
   functions get round-trip tests against ws-scrcpy's documented byte layout.
4. `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` and
   `cargo nextest run --locked` (or `cargo test --locked`) pass.
5. Manual on three platforms (Linux Fedora KDE / Windows / macOS): with an
   emulator AVD running and an ADB device visible, open a Device Preview tab,
   confirm the device display renders in the pane; tap/swipe on the canvas lands
   on the device; closing the tab kills the bundled scrcpy server child (verified
   via `ps -ef | grep scrcpy` returning nothing after close on Linux/macOS, Task
   Manager on Windows).
6. Manual Wayland smoke: on a Fedora 44 KDE Plasma (Wayland) session, repeat step
   5. Confirm identical behavior; the device pane must not require any Wayland
   portal grant or root iframe permissions beyond Terra's existing CSP.
7. Bundle size: `pnpm tauri build` output is within the 7-8 MB budget (the JAR is
   ~100 KB, well inside the slack).
8. Roadmap amendment: move the existing "Embedded Android Device Preview" Planned
   entry into the Shipped section of `ROADMAP.md` (it was pre-added in commit
   `72b583b`). "Smart Dev Server Auto-Docking" widening to also cover device-tab
   auto-open is a separate follow-up, tracked here, not in v1.