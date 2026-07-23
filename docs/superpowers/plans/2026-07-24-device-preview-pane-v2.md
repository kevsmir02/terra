# Device Preview Pane v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Device Preview Pane input bridge from v1 `adb shell input` fallback to scrcpy's native binary control protocol over TCP for sub-20ms touch, drag, scroll, and key injection latency.

**Architecture:** Launch `scrcpy-server` with `control=true`, establish dual TCP port forwards via `adb forward`, manage the control socket via an async MPSC queue task in `DeviceSession` (`session.rs`), implement big-endian scrcpy binary serializers in `control.rs`, and wire frontend `controlBridge.ts` with RAF throttling and coordinate normalization.

**Tech Stack:** Rust (Tauri 2, tokio, byteorder/std binary operations), TypeScript (React, canvas events, requestAnimationFrame).

## Global Constraints

- Target scrcpy binary control protocol frames (`InjectTouchEvent` type 2, `InjectKeycodeEvent` type 0, `InjectScrollEvent` type 3).
- Target touch input latency < 20ms.
- Fallback gracefully to `adb shell input` if control socket drops or fails to connect.
- Code style: clean compilation under `cargo clippy --all-targets --locked -- -D warnings` and `pnpm check-types` / `pnpm lint`.

---

### Task 1: Rust Binary Protocol Serializer (`src-tauri/src/modules/device/control.rs`)

**Files:**
- Create: `src-tauri/src/modules/device/control.rs`
- Modify: `src-tauri/src/modules/device/mod.rs`
- Test: `src-tauri/src/modules/device/control.rs` (inline unit tests)

**Interfaces:**
- Consumes: Primitive input types (action, x, y, width, height, keycode, metastate, scroll deltas).
- Produces: `ControlMessage` enum and `serialize_control_message(msg: &ControlMessage) -> Vec<u8>`.

- [ ] **Step 1: Write the failing tests for `control.rs`**

Create `src-tauri/src/modules/device/control.rs` with types and failing unit tests:

```rust
use std::io::Write;

#[derive(Debug, Clone, PartialEq)]
pub enum TouchAction {
    Down = 0,
    Up = 1,
    Move = 2,
}

#[derive(Debug, Clone, PartialEq)]
pub enum KeyAction {
    Down = 0,
    Up = 1,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ControlMessage {
    InjectTouch {
        action: TouchAction,
        pointer_id: i64,
        x: u32,
        y: u32,
        width: u16,
        height: u16,
        pressure: u16,
        buttons: u32,
    },
    InjectKeycode {
        action: KeyAction,
        keycode: u32,
        repeat: u32,
        metastate: u32,
    },
    InjectScroll {
        x: u32,
        y: u32,
        width: u16,
        height: u16,
        h: i32,
        v: i32,
        buttons: u32,
    },
}

pub fn serialize_control_message(msg: &ControlMessage) -> Vec<u8> {
    todo!("implement serializer")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_inject_touch_down() {
        let msg = ControlMessage::InjectTouch {
            action: TouchAction::Down,
            pointer_id: -1,
            x: 540,
            y: 960,
            width: 1080,
            height: 1920,
            pressure: 0xFFFF,
            buttons: 1,
        };
        let bytes = serialize_control_message(&msg);
        assert_eq!(bytes.len(), 28);
        assert_eq!(bytes[0], 2); // Type 2 = INJECT_TOUCH_EVENT
        assert_eq!(bytes[1], 0); // Action 0 = Down
        assert_eq!(&bytes[2..10], &(-1i64).to_be_bytes());
        assert_eq!(&bytes[10..14], &540u32.to_be_bytes());
        assert_eq!(&bytes[14..18], &960u32.to_be_bytes());
        assert_eq!(&bytes[18..20], &1080u16.to_be_bytes());
        assert_eq!(&bytes[20..22], &1920u16.to_be_bytes());
        assert_eq!(&bytes[22..24], &0xFFFFu16.to_be_bytes());
        assert_eq!(&bytes[24..28], &1u32.to_be_bytes());
    }

    #[test]
    fn test_serialize_inject_keycode() {
        let msg = ControlMessage::InjectKeycode {
            action: KeyAction::Down,
            keycode: 4, // AKEYCODE_BACK
            repeat: 0,
            metastate: 0,
        };
        let bytes = serialize_control_message(&msg);
        assert_eq!(bytes.len(), 14);
        assert_eq!(bytes[0], 0); // Type 0 = INJECT_KEYCODE_EVENT
        assert_eq!(bytes[1], 0); // Action 0 = Down
        assert_eq!(&bytes[2..6], &4u32.to_be_bytes());
        assert_eq!(&bytes[6..10], &0u32.to_be_bytes());
        assert_eq!(&bytes[10..14], &0u32.to_be_bytes());
    }

    #[test]
    fn test_serialize_inject_scroll() {
        let msg = ControlMessage::InjectScroll {
            x: 100,
            y: 200,
            width: 1080,
            height: 1920,
            h: 0,
            v: -5,
            buttons: 0,
        };
        let bytes = serialize_control_message(&msg);
        assert_eq!(bytes.len(), 25);
        assert_eq!(bytes[0], 3); // Type 3 = INJECT_SCROLL_EVENT
        assert_eq!(&bytes[1..5], &100u32.to_be_bytes());
        assert_eq!(&bytes[5..9], &200u32.to_be_bytes());
        assert_eq!(&bytes[9..11], &1080u16.to_be_bytes());
        assert_eq!(&bytes[11..13], &1920u16.to_be_bytes());
        assert_eq!(&bytes[13..17], &0i32.to_be_bytes());
        assert_eq!(&bytes[17..21], &(-5i32).to_be_bytes());
        assert_eq!(&bytes[21..25], &0u32.to_be_bytes());
    }
}
```

Add `pub mod control;` to `src-tauri/src/modules/device/mod.rs`.

- [ ] **Step 2: Run cargo test to verify tests fail**

Run: `cd src-tauri && cargo test modules::device::control::tests --locked`
Expected: FAIL with `panicked at 'not yet implemented: implement serializer'`

- [ ] **Step 3: Implement binary protocol serialization**

Update `serialize_control_message` in `src-tauri/src/modules/device/control.rs`:

```rust
pub fn serialize_control_message(msg: &ControlMessage) -> Vec<u8> {
    match msg {
        ControlMessage::InjectTouch {
            action,
            pointer_id,
            x,
            y,
            width,
            height,
            pressure,
            buttons,
        } => {
            let mut buf = Vec::with_capacity(28);
            buf.push(2); // Type 2
            buf.push(action.clone() as u8);
            buf.extend_from_slice(&pointer_id.to_be_bytes());
            buf.extend_from_slice(&x.to_be_bytes());
            buf.extend_from_slice(&y.to_be_bytes());
            buf.extend_from_slice(&width.to_be_bytes());
            buf.extend_from_slice(&height.to_be_bytes());
            buf.extend_from_slice(&pressure.to_be_bytes());
            buf.extend_from_slice(&buttons.to_be_bytes());
            buf
        }
        ControlMessage::InjectKeycode {
            action,
            keycode,
            repeat,
            metastate,
        } => {
            let mut buf = Vec::with_capacity(14);
            buf.push(0); // Type 0
            buf.push(action.clone() as u8);
            buf.extend_from_slice(&keycode.to_be_bytes());
            buf.extend_from_slice(&repeat.to_be_bytes());
            buf.extend_from_slice(&metastate.to_be_bytes());
            buf
        }
        ControlMessage::InjectScroll {
            x,
            y,
            width,
            height,
            h,
            v,
            buttons,
        } => {
            let mut buf = Vec::with_capacity(25);
            buf.push(3); // Type 3
            buf.extend_from_slice(&x.to_be_bytes());
            buf.extend_from_slice(&y.to_be_bytes());
            buf.extend_from_slice(&width.to_be_bytes());
            buf.extend_from_slice(&height.to_be_bytes());
            buf.extend_from_slice(&h.to_be_bytes());
            buf.extend_from_slice(&v.to_be_bytes());
            buf.extend_from_slice(&buttons.to_be_bytes());
            buf
        }
    }
}
```

- [ ] **Step 4: Run cargo test to verify it passes**

Run: `cd src-tauri && cargo test modules::device::control::tests --locked`
Expected: PASS (3 tests passed)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/device/control.rs src-tauri/src/modules/device/mod.rs
git commit -m "feat(device): add scrcpy binary control protocol serializer"
```

---

### Task 2: Dual TCP Port Forward & Async Control Session (`server.rs`, `session.rs`, `commands.rs`)

**Files:**
- Modify: `src-tauri/src/modules/device/server.rs:10-20`
- Modify: `src-tauri/src/modules/device/session.rs:19-75`
- Modify: `src-tauri/src/modules/device/commands.rs:68-120`
- Test: `src-tauri/src/modules/device/server.rs` (update unit tests)

**Interfaces:**
- Consumes: `ControlMessage` from Task 1.
- Produces: `control_tx: tokio::sync::mpsc::Sender<ControlMessage>` inside `DeviceSession`, and IPC command `device_send_control`.

- [ ] **Step 1: Update scrcpy server command to enable `control=true`**

In `src-tauri/src/modules/device/server.rs`:

Update `build_server_command`:
```rust
pub fn build_server_command(adb: &Path, _jar: &Path, serial: &str, _local_port: u16) -> Command {
    let classpath_arg = format!("CLASSPATH={DEVICE_JAR_PATH}");
    let server_arg = format!(
        "app_process / com.genymobile.scrcpy.Server {SCRCPY_SERVER_VERSION} \
         tunnel_forward=true audio=false control=true cleanup=false \
         raw_stream=true max_size=1920 max_fps=30 video_codec=h264"
    );
    let mut cmd = Command::new(adb);
    cmd.args(["-s", serial, "shell", &classpath_arg, &server_arg]);
    cmd
}
```

Update unit test `build_server_command_uses_serial_and_pinned_version`:
```rust
assert!(args[4].contains("control=true"));
```

- [ ] **Step 2: Update `push_jar_and_forward` for dual socket forwards**

In `src-tauri/src/modules/device/server.rs`, forward both video (`tcp:{local_port}`) and control (`tcp:{local_port + 1}`):

```rust
    let forward_spec_video = format!("tcp:{local_port}");
    let forward_spec_control = format!("tcp:{}", local_port + 1);
    let abstract_spec = format!("localabstract:{LOCAL_ABSTRACT_NAME}");
    
    let fwd_video = Command::new(adb)
        .args(["-s", serial, "forward", &forward_spec_video, &abstract_spec])
        .output()
        .map_err(|e| format!("adb forward video failed: {e}"))?;
    if !fwd_video.status.success() {
        return Err(format!("adb forward video failed: {}", String::from_utf8_lossy(&fwd_video.stderr)));
    }

    let fwd_control = Command::new(adb)
        .args(["-s", serial, "forward", &forward_spec_control, &abstract_spec])
        .output()
        .map_err(|e| format!("adb forward control failed: {e}"))?;
    if !fwd_control.status.success() {
        return Err(format!("adb forward control failed: {}", String::from_utf8_lossy(&fwd_control.stderr)));
    }
```

- [ ] **Step 3: Update `DeviceSession` to spawn the async control queue worker**

In `src-tauri/src/modules/device/session.rs`:

Add `control_tx` channel to `DeviceSession`:
```rust
use tokio::sync::mpsc;
use super::control::{serialize_control_message, ControlMessage};

pub struct DeviceSession {
    pub id: u32,
    pub serial: String,
    pub local_port: u16,
    pub adb: PathBuf,
    pub server_child: Option<Child>,
    pub video_stream: Option<ChildStdout>,
    pub stopping: Arc<AtomicBool>,
    pub control_tx: mpsc::Sender<ControlMessage>,
}
```

In `DeviceSession::spawn`, create MPSC channel (`capacity = 128`) and spawn background task `run_control_loop`:
```rust
    pub fn spawn(
        id: u32,
        adb: PathBuf,
        jar: PathBuf,
        serial: String,
        local_port: u16,
        channel: Channel<DeviceFrame>,
    ) -> Result<Self, String> {
        let child = super::server::spawn_server(&adb, &jar, &serial, local_port)?;
        let stopping = Arc::new(AtomicBool::new(false));
        let stop_clone = stopping.clone();
        
        let (tx, mut rx) = mpsc::channel::<ControlMessage>(128);
        let control_port = local_port + 1;
        let stop_control = stopping.clone();

        tauri::async_runtime::spawn_blocking(move || {
            run_read_loop(local_port, channel, stop_clone);
        });

        tauri::async_runtime::spawn_blocking(move || {
            run_control_loop(control_port, &mut rx, stop_control);
        });

        Ok(Self {
            id,
            serial,
            local_port,
            adb,
            server_child: Some(child),
            video_stream: None,
            stopping,
            control_tx: tx,
        })
    }
```

Implement `run_control_loop`:
```rust
fn run_control_loop(
    control_port: u16,
    rx: &mut mpsc::Receiver<ControlMessage>,
    stopping: Arc<AtomicBool>,
) {
    use std::io::Write;
    let mut stream: Option<std::net::TcpStream> = None;
    for attempt in 1..=30 {
        if stopping.load(Ordering::Relaxed) {
            return;
        }
        if let Ok(s) = std::net::TcpStream::connect(("127.0.0.1", control_port)) {
            stream = Some(s);
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    let mut stream = match stream {
        Some(s) => s,
        None => {
            log::warn!("[device] control_loop: TCP connect failed for 127.0.0.1:{control_port}");
            return;
        }
    };

    while !stopping.load(Ordering::Relaxed) {
        if let Ok(msg) = rx.try_recv() {
            let bytes = serialize_control_message(&msg);
            if stream.write_all(&bytes).is_err() {
                log::warn!("[device] control_loop write failed");
                break;
            }
        } else {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
}
```

- [ ] **Step 4: Update `commands.rs` to expose `device_send_control` IPC command**

In `src-tauri/src/modules/device/commands.rs`:

```rust
use super::control::{ControlMessage, KeyAction, TouchAction};

#[tauri::command]
pub async fn device_send_touch(
    state: State<'_, DeviceState>,
    handle: u32,
    action: u8,
    pointer_id: i64,
    x: u32,
    y: u32,
    width: u16,
    height: u16,
) -> Result<(), String> {
    let sessions = state.sessions.read().map_err(|e| e.to_string())?;
    let session = sessions.get(&handle).ok_or("session not found")?;
    let act = match action {
        0 => TouchAction::Down,
        1 => TouchAction::Up,
        _ => TouchAction::Move,
    };
    let msg = ControlMessage::InjectTouch {
        action: act,
        pointer_id,
        x,
        y,
        width,
        height,
        pressure: 0xFFFF,
        buttons: 1,
    };
    let _ = session.control_tx.try_send(msg);
    Ok(())
}

#[tauri::command]
pub async fn device_send_key(
    state: State<'_, DeviceState>,
    handle: u32,
    action: u8,
    keycode: u32,
    metastate: u32,
) -> Result<(), String> {
    let sessions = state.sessions.read().map_err(|e| e.to_string())?;
    let session = sessions.get(&handle).ok_or("session not found")?;
    let act = if action == 0 { KeyAction::Down } else { KeyAction::Up };
    let msg = ControlMessage::InjectKeycode {
        action: act,
        keycode,
        repeat: 0,
        metastate,
    };
    let _ = session.control_tx.try_send(msg);
    Ok(())
}
```

Register `device_send_touch` and `device_send_key` in `src-tauri/src/lib.rs`.

- [ ] **Step 5: Run tests and clippy**

Run: `cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings`
Expected: PASS cleanly.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/device/
git commit -m "feat(device): implement dual-socket scrcpy control queue in Rust backend"
```

---

### Task 3: Frontend Control Bridge & Throttling (`controlBridge.ts`)

**Files:**
- Create/Modify: `src/modules/device/controlBridge.ts`
- Create: `src/modules/device/controlBridge.test.ts`
- Modify: `src/modules/device/DevicePreviewPane.tsx`

**Interfaces:**
- Consumes: DOM pointer events and Tauri IPC `device_send_touch` / `device_send_key`.
- Produces: Sub-20ms gesture input handling on `<video>`.

- [ ] **Step 1: Write failing unit test for `controlBridge` coordinate conversion**

Create `src/modules/device/controlBridge.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { scaleCoordinates } from "./controlBridge";

describe("scaleCoordinates", () => {
  it("scales client coordinates to target device resolution", () => {
    const clientX = 100;
    const clientY = 200;
    const rect = { left: 0, top: 0, width: 500, height: 1000 } as DOMRect;
    const deviceW = 1080;
    const deviceH = 2160;

    const scaled = scaleCoordinates(clientX, clientY, rect, deviceW, deviceH);
    expect(scaled.x).toBe(216);
    expect(scaled.y).toBe(432);
    expect(scaled.width).toBe(1080);
    expect(scaled.height).toBe(2160);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/modules/device/controlBridge.test.ts`
Expected: FAIL with `scaleCoordinates is not defined`

- [ ] **Step 3: Implement `controlBridge.ts`**

Update/create `src/modules/device/controlBridge.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

export function scaleCoordinates(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  deviceWidth: number,
  deviceHeight: number,
) {
  const relX = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const relY = Math.max(0, Math.min(clientY - rect.top, rect.height));

  const x = Math.round((relX / rect.width) * deviceWidth);
  const y = Math.round((relY / rect.height) * deviceHeight);

  return { x, y, width: deviceWidth, height: deviceHeight };
}

export class DeviceControlBridge {
  private handle: number;
  private deviceWidth: number;
  private deviceHeight: number;
  private rafId: number | null = null;
  private pendingMove: { clientX: number; clientY: number; rect: DOMRect } | null = null;

  constructor(handle: number, deviceWidth = 1080, deviceHeight = 1920) {
    this.handle = handle;
    this.deviceWidth = deviceWidth;
    this.deviceHeight = deviceHeight;
  }

  public handlePointerDown(e: React.PointerEvent<HTMLVideoElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y, width, height } = scaleCoordinates(
      e.clientX,
      e.clientY,
      rect,
      this.deviceWidth,
      this.deviceHeight,
    );
    invoke("device_send_touch", {
      handle: this.handle,
      action: 0, // Down
      pointerId: e.pointerId,
      x,
      y,
      width,
      height,
    });
  }

  public handlePointerMove(e: React.PointerEvent<HTMLVideoElement>) {
    if (e.buttons === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    this.pendingMove = { clientX: e.clientX, clientY: e.clientY, rect };

    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (!this.pendingMove) return;
        const { clientX, clientY, rect: r } = this.pendingMove;
        const { x, y, width, height } = scaleCoordinates(
          clientX,
          clientY,
          r,
          this.deviceWidth,
          this.deviceHeight,
        );
        invoke("device_send_touch", {
          handle: this.handle,
          action: 2, // Move
          pointerId: e.pointerId,
          x,
          y,
          width,
          height,
        });
      });
    }
  }

  public handlePointerUp(e: React.PointerEvent<HTMLVideoElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y, width, height } = scaleCoordinates(
      e.clientX,
      e.clientY,
      rect,
      this.deviceWidth,
      this.deviceHeight,
    );
    invoke("device_send_touch", {
      handle: this.handle,
      action: 1, // Up
      pointerId: e.pointerId,
      x,
      y,
      width,
      height,
    });
  }
}
```

- [ ] **Step 4: Run Vitest to verify test passes**

Run: `pnpm test src/modules/device/controlBridge.test.ts`
Expected: PASS

- [ ] **Step 5: Bind `DeviceControlBridge` in `DevicePreviewPane.tsx`**

In `src/modules/device/DevicePreviewPane.tsx`, update video event listeners to use `DeviceControlBridge`:

```tsx
<video
  ref={videoRef}
  onPointerDown={(e) => bridgeRef.current?.handlePointerDown(e)}
  onPointerMove={(e) => bridgeRef.current?.handlePointerMove(e)}
  onPointerUp={(e) => bridgeRef.current?.handlePointerUp(e)}
/>
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/device/
git commit -m "feat(device): wire low-latency binary touch control bridge in DevicePreviewPane"
```

---

### Task 4: Complete System Verification

**Files:**
- Repository-wide checks.

- [ ] **Step 1: Run TypeScript type checking**

Run: `pnpm check-types`
Expected: PASS (0 errors)

- [ ] **Step 2: Run Biome linter**

Run: `pnpm lint`
Expected: PASS (0 errors)

- [ ] **Step 3: Run full Rust & Frontend test suites**

Run: `pnpm test && cd src-tauri && cargo test --locked`
Expected: PASS

- [ ] **Step 4: Run Clippy**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: PASS (0 warnings)

- [ ] **Step 5: Final Commit**

```bash
git commit --allow-empty -m "chore(device): verify device preview pane v2 binary control protocol"
```
