# Device mirroring

This guide elaborates on `TERRA.md`. If anything here conflicts with `TERRA.md`, `TERRA.md` wins. Vocabulary (device, serial, readiness, AVD, emulator, session, mirror, dock) is defined in `GLOSSARY.md`.

The module lives in `src-tauri/src/modules/device/` and mirrors an Android device or emulator into the dock, driven by the platform-tools on PATH. It is on demand: nothing runs until the dock opens, and everything it started dies when the session closes or the app exits.

## Discovery (`adb.rs`)

Resolves `adb` / `emulator` / `avdmanager` and parses their output into `DeviceEntry`. That type is exported once via `ts-rs` during `cargo test` into `src/modules/device/generated/DeviceEntry.ts`, so the frontend cannot restate it and drift; CI fails if the export is not committed. `DeviceEntry::is_ready` (readiness) replaces comparing the raw `state` string against the literal `"device"` everywhere it is checked.

## Server (`server.rs`)

Pushes and starts the bundled `scrcpy-server-4.1.jar` (shipped via `bundle.resources`) in frame-metadata mode: `send_frame_meta=true`, device/stream meta and the dummy byte off, `video_bit_rate=4000000`, `clipboard_autosync=false`, `max_size=1920`, `max_fps=30`.

Each session gets its own `scid` and abstract socket `scrcpy_<scid>`, so two live sessions never collide on the wire. Both forwarded ports are claimed explicitly rather than one assumed from the other, and a failed start removes both.

## Session (`session.rs`)

`device_open` hands `DeviceSession::spawn` an `on_frame: Channel<Response>` of raw bytes and an `on_exit: Channel<DeviceExit>`. Spawn runs in `spawn_blocking`, so opening a session never stalls the IPC thread; `device_close` runs the teardown the same way, since it waits on the adb client.

`on_exit` carries one of `server-unreachable`, `stream-ended`, `stream-error: <io>`, `stream-corrupt`, and is sent only when the webview did not itself ask for the stop. That lets the pane dim the frozen last frame and offer Reconnect rather than mistake a dead mirror for a live one. The control loop blocks on its receiver instead of polling.

## Remux (`remux.rs`) and pacing (`timeline.rs`)

`StreamAssembler` is pure: bytes in, encoded frames out. It reads the 12-byte frame-metadata packet header, bootstraps from the CONFIG packet (the init segment is emitted once; a later CONFIG is ignored, so a mid-stream rotation keeps the original geometry until the session restarts), and packages one fMP4 fragment per access unit with sync flags from the KEY_FRAME flag. Fragments are prefixed with a discriminator byte (`FRAME_INIT` / `FRAME_MEDIA`) on the same raw-byte channel the terminal uses. An oversized packet puts the assembler into a corrupt state and the reader stops.

`FrameTimeline` paces those fragments from the capture's real presentation timestamps, with durations clamped to [1 ms, 100 ms] so Media Source Extensions never sees a discontinuity.

## Control (`control.rs`) and state (`state.rs`)

`control.rs` encodes touch, key, and scroll control messages for the scrcpy binary control protocol. `state.rs` holds live sessions and Terra-launched AVDs; all of them are killed on `RunEvent::Exit`. AVDs the user started elsewhere are left alone.

## Input validation

Every process is spawned argv-style, never through a shell. Two values arrive from IPC and are validated before they reach `adb`: AVD names via `is_safe_avd_name`, and serials via `ensure_safe_serial` (`emulator-5554` and `host:port` shapes only, no leading `-`). Coordinates are `u32`, so they cannot carry an argument. Adding a command that takes a serial means calling `ensure_safe_serial` on it.

## Frontend (`src/modules/device/`)

`deviceSession.ts` reports `connecting` until the first decoded frame, then `streaming`, and `disconnected` when the session dies unexpectedly, never on its own initiative. A disconnected pane shows the dimmed last frame and a Reconnect button; there is no auto-reconnect (`docs/adr/0001-mirror-does-not-reconnect-automatically.md`).

`playbackPolicy.ts` is a pure policy that evicts behind the playhead, seeks to live after a stall, and heals a stranded playhead, so memory stays constant no matter how long the dock stays open.

The dock and dropdown load through `DeviceDockLazy.tsx` and `DeviceDropdownLazy.tsx`, keeping the module out of the eager startup graph.
