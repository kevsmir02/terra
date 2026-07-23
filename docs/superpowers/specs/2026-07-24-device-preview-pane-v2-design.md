# Design: Device Preview Pane v2 — scrcpy Native Binary Control Protocol

**Date:** 2026-07-24
**Status:** Approved

## Goal

Upgrade the **Device Preview Pane** input interaction layer from the v1 `adb shell input` fallback path (~50–100ms per input event, single-touch only) to `scrcpy`'s native binary control protocol over a direct TCP control socket.

This achieves **sub-20ms touch latency**, smooth continuous drag/swipe gestures, trackpad/wheel scrolling support, and immediate keyboard input injection, fully unlocking native-feeling interactive mobile preview inside Terra.

---

## Decision Context & Background

In v1 (`docs/superpowers/specs/2026-07-23-device-preview-pane-design.md`), `scrcpy-server` was spawned with `control=false` to simplify raw H.264 stream demuxing. Pointer and keyboard input were handled via single-shot `adb shell input tap/swipe/keyevent` subprocess calls.

While functional, `adb shell input` suffers from:
1. High process invocation latency (~50-100ms per tap).
2. Absence of smooth drag or swipe gesture continuation (each movement spawns a new process).
3. No multi-touch or trackpad wheel scroll capabilities.

In v2, Terra opens the scrcpy control socket alongside the video stream socket, serializing input directly to binary packets sent over TCP.

---

## Architecture & Data Flow

### 1. Dual TCP Socket Topology (`scrcpy-server`)

When initializing a device preview session in `src-tauri/src/modules/device/session.rs`:

- `scrcpy-server` is launched with `control=true` and `tunnel_forward=true`.
- Two local TCP port forwards are established via `adb forward`:
  - `LOCAL_PORT` -> `localabstract:terax-scrcpy` (Video H.264 Stream Socket)
  - `LOCAL_PORT + 1` -> `localabstract:terax-scrcpy` (Control Packet Socket)

```
[ DevicePreviewPane UI ]
         |
  (DOM Events: pointer, wheel, keydown)
         |
         v
[ src/modules/device/controlBridge.ts ]
   - Scaled coordinates (canvas -> native device resolution)
   - Throttling high-freq move events to ~60Hz via RAF
   - IPC: invoke("device_send_touch" | "device_send_key" | "device_send_scroll")
         |
         v (Tauri IPC < 1ms)
[ src-tauri/src/modules/device/commands.rs ]
   - Pushes ControlMessage struct to session MPSC channel
         |
         v (mpsc::Sender<ControlMessage>)
[ src-tauri/src/modules/device/session.rs ]
   - Async Control Task reads MPSC queue
   - Calls control::serialize_message(&msg)
         |
         v (Big-Endian Binary Frame)
[ scrcpy Control TCP Socket (127.0.0.1:LOCAL_PORT+1) ]
         |
         v
[ scrcpy-server on Android Device ]
```

---

### 2. Rust Binary Protocol Serializer (`src-tauri/src/modules/device/control.rs`)

`control.rs` encodes input structs into scrcpy big-endian binary protocol frames:

1. **`InjectTouchEvent` (Type 2, 28 Bytes)**
   - `[0..1]`: Type (`0x02`)
   - `[1..2]`: Action (`0` = Down, `1` = Up, `2` = Move)
   - `[2..10]`: Pointer ID (`i64` big-endian)
   - `[10..14]`: Position X (`u32` big-endian)
   - `[14..18]`: Position Y (`u32` big-endian)
   - `[18..20]`: Screen Width (`u16` big-endian)
   - `[20..22]`: Screen Height (`u16` big-endian)
   - `[22..24]`: Pressure (`u16` big-endian)
   - `[24..28]`: Action Button / Buttons (`u32` big-endian)

2. **`InjectKeycodeEvent` (Type 0, 14 Bytes)**
   - `[0..1]`: Type (`0x00`)
   - `[1..2]`: Action (`0` = Down, `1` = Up)
   - `[2..6]`: Keycode (`u32` big-endian, Android `AKEYCODE_*`)
   - `[6..10]`: Repeat (`u32` big-endian)
   - `[10..14]`: Metastate (`u32` big-endian)

3. **`InjectScrollEvent` (Type 3, 25 Bytes)**
   - `[0..1]`: Type (`0x03`)
   - `[1..5]`: Position X (`u32` big-endian)
   - `[5..9]`: Position Y (`u32` big-endian)
   - `[9..11]`: Screen Width (`u16` big-endian)
   - `[11..13]`: Screen Height (`u16` big-endian)
   - `[13..17]`: Horizontal Scroll Delta (`i32` big-endian)
   - `[17..21]`: Vertical Scroll Delta (`i32` big-endian)
   - `[21..25]`: Buttons (`u32` big-endian)

---

### 3. Frontend Input Bridge (`src/modules/device/controlBridge.ts`)

- Binds to `<video>` element pointer and keyboard events.
- **Coordinate Transformation**: Normalizes element pointer bounding rect to device's reported native pixel resolution.
- **Throttling**: High-frequency `pointermove` events are throttled to `requestAnimationFrame` cycles to avoid flooding the IPC channel.
- **Dispatches**:
  - `device_send_touch(sessionId, action, pointerId, x, y, width, height)`
  - `device_send_key(sessionId, action, keycode, metastate)`
  - `device_send_scroll(sessionId, x, y, width, height, h, v)`

---

## Error Handling & Resiliency

1. **Automatic Fallback to `adb shell input`**:
   - If the control TCP socket fails to connect or breaks during a session, the backend logs a warning and automatically falls back to issuing `adb shell input` commands so the user never loses touch interaction.
2. **Channel Saturation Guard**:
   - The control MPSC channel has a capacity of 128 items. If the device socket drops behind and the queue fills up, intermediate `MOVE` touch events are dropped while keeping `DOWN` and `UP` events intact to prevent stuck gesture states.

---

## Testing & Verification Plan

1. **Rust Binary Serialization Tests**:
   - Unit tests in `src-tauri/src/modules/device/control.rs` verifying byte array serialization of `InjectTouchEvent`, `InjectKeycodeEvent`, and `InjectScrollEvent` against known reference byte patterns.
2. **Frontend Coordinate & Throttling Tests**:
   - Unit tests in `src/modules/device/controlBridge.test.ts` for coordinate mapping logic and RAF throttling.
3. **Automated Integration Checks**:
   - `pnpm check-types`
   - `pnpm lint`
   - `cargo clippy --all-targets --locked -- -D warnings`
   - `cargo test --locked`
4. **Manual Verification**:
   - Smoke test against running Android emulator (`emulator-5554`) verifying low-latency tap, smooth drag scroll, keyboard input, and home/back key injection.
