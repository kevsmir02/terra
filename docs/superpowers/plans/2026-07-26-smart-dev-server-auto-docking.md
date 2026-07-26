# Smart Dev Server Auto-Docking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect loopback dev-server URLs in PTY output and offer to open them in the web preview tab via a dismissible chip on the terminal pane.

**Architecture:** A third byte-stream scanner in the Rust PTY reader thread (beside `agent_detect` and `da_filter`) emits a `terra:dev-server` Tauri event. The frontend owns all policy — dedup, dismissal memory, and display — in a zustand store keyed by leaf id.

**Tech Stack:** Rust (Tauri 2, `portable-pty`), TypeScript, React 19, zustand, vitest, cargo nextest.

**Spec:** `docs/superpowers/specs/2026-07-26-smart-dev-server-auto-docking-design.md`

## Global Constraints

- **Scheme is required.** Only `http://` and `https://` (lowercase) match. Bare `localhost:5173` never matches.
- **Loopback hosts only:** `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`. LAN addresses (`192.168.x`, `10.x`, `172.16-31.x`) never match.
- **Port required**, 1–65535. `http://localhost` with no port never matches.
- **`0.0.0.0` is rewritten to `localhost`** in the emitted URL — it is not loadable in an iframe.
- **Candidate cap: 2048 bytes.** Over that, the candidate is discarded (runaway guard, mirrors `da_filter`'s `HOLD_MAX`).
- **Escape sequences end a candidate**; square brackets do NOT (needed by `[::1]`).
- **Repeat collapse in Rust is immediate-only** — the detector remembers just the last URL it emitted.
- **No new dependencies.** Everything here uses crates and packages already in `Cargo.toml` / `package.json`.
- Rust lint must stay clean: `cargo clippy --all-targets --locked -- -D warnings`.

---

## File Structure

**Create**
- `src-tauri/src/modules/pty/url_detect.rs` — the byte scanner, the URL matcher, and the `DevServerSignal` payload. Self-contained and pure; no Tauri types beyond `serde::Serialize`.
- `src/modules/preview/lib/devServerStore.ts` — zustand store, pure reducers, event listener binding, opener registration.
- `src/modules/preview/DevServerChip.tsx` — the chip UI.

**Modify**
- `src-tauri/src/modules/pty/mod.rs:1-4` — module declaration.
- `src-tauri/src/modules/pty/session.rs` — event const, detector construction, one `process` call in the reader loop.
- `src/modules/terminal/lib/useTerminalSession.ts` — bind the listener; clear store state on PTY exit.
- `src/modules/terminal/PaneTreeView.tsx:58` — render the chip beside `DropOverlay`.
- `src/app/App.tsx` — register `openPreviewTab` as the chip's opener.
- `src/modules/preview/index.ts` — exports.

---

### Task 1: Rust URL detector

Pure logic, no wiring. Nothing else in the codebase changes.

**Files:**
- Create: `src-tauri/src/modules/pty/url_detect.rs`
- Modify: `src-tauri/src/modules/pty/mod.rs:1-4`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct UrlDetector` with `pub fn new() -> Self` and `pub fn process<F: FnMut(&str)>(&mut self, input: &[u8], emit: F)`
  - `pub struct DevServerSignal { pub id: u32, pub url: String }`, `Clone + serde::Serialize`

- [ ] **Step 1: Declare the module**

In `src-tauri/src/modules/pty/mod.rs`, change lines 1-4 from:

```rust
mod agent_detect;
mod da_filter;
mod session;
pub(crate) mod shell_init;
```

to:

```rust
mod agent_detect;
mod da_filter;
mod session;
pub(crate) mod shell_init;
mod url_detect;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/modules/pty/url_detect.rs` containing ONLY this test module (the implementation comes in Step 4):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn run(d: &mut UrlDetector, input: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        d.process(input, |u| out.push(u.to_string()));
        out
    }

    #[test]
    fn plain_localhost_match() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://localhost:5173\n"), vec!["http://localhost:5173"]);
    }

    #[test]
    fn colour_wrapped_url_matches() {
        let mut d = UrlDetector::new();
        let input = b"  \x1b[32m\xe2\x9e\x9c\x1b[39m  Local:   \x1b[36mhttp://localhost:5173/\x1b[39m\r\n";
        assert_eq!(run(&mut d, input), vec!["http://localhost:5173/"]);
    }

    #[test]
    fn split_across_chunks() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://localh").is_empty());
        assert_eq!(run(&mut d, b"ost:5173\n"), vec!["http://localhost:5173"]);
    }

    #[test]
    fn loopback_ipv4_and_path() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://127.0.0.1:8000/docs "), vec!["http://127.0.0.1:8000/docs"]);
    }

    #[test]
    fn https_matches() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"https://localhost:3000\n"), vec!["https://localhost:3000"]);
    }

    #[test]
    fn ipv6_literal_matches() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://[::1]:4321\n"), vec!["http://[::1]:4321"]);
    }

    #[test]
    fn wildcard_host_rewritten_to_localhost() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://0.0.0.0:8080/\n"), vec!["http://localhost:8080/"]);
    }

    #[test]
    fn bare_host_without_scheme_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"localhost:5173\n").is_empty());
    }

    #[test]
    fn lan_address_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://192.168.1.5:5173\n").is_empty());
    }

    #[test]
    fn missing_port_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://localhost\n").is_empty());
    }

    #[test]
    fn port_out_of_range_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://localhost:99999\n").is_empty());
    }

    #[test]
    fn non_loopback_host_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://example.com:80\n").is_empty());
    }

    #[test]
    fn repeat_collapsed_in_one_chunk() {
        let mut d = UrlDetector::new();
        let out = run(&mut d, b"http://localhost:5173\nhttp://localhost:5173\n");
        assert_eq!(out, vec!["http://localhost:5173"]);
    }

    #[test]
    fn repeat_collapsed_across_chunks() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://localhost:5173\n"), vec!["http://localhost:5173"]);
        assert!(run(&mut d, b"http://localhost:5173\n").is_empty());
    }

    #[test]
    fn different_url_after_repeat_emits() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://localhost:5173\n"), vec!["http://localhost:5173"]);
        assert_eq!(run(&mut d, b"http://localhost:6006\n"), vec!["http://localhost:6006"]);
        assert_eq!(run(&mut d, b"http://localhost:5173\n"), vec!["http://localhost:5173"]);
    }

    #[test]
    fn runaway_candidate_discarded_at_cap() {
        let mut d = UrlDetector::new();
        let mut input = Vec::from(b"http://localhost:5173/".as_slice());
        input.extend(std::iter::repeat_n(b'a', CAND_MAX + 10));
        input.push(b'\n');
        assert!(run(&mut d, &input).is_empty());
    }

    #[test]
    fn candidate_open_at_end_of_chunk_is_not_emitted() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://localhost:5173").is_empty());
    }

    #[test]
    fn quotes_and_parens_terminate() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"(http://localhost:5173)"), vec!["http://localhost:5173"]);
    }

    #[test]
    fn osc_sequence_does_not_leak_into_candidate() {
        let mut d = UrlDetector::new();
        let input = b"\x1b]0;title\x07http://localhost:5173\n";
        assert_eq!(run(&mut d, input), vec!["http://localhost:5173"]);
    }

    #[test]
    fn plain_text_emits_nothing() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"hello world\nno urls here\n").is_empty());
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --locked url_detect`
Expected: FAIL — `cannot find type UrlDetector in this scope` (and similar for `CAND_MAX`).

- [ ] **Step 4: Write the implementation**

Prepend this ABOVE the `#[cfg(test)] mod tests` block in `src-tauri/src/modules/pty/url_detect.rs`:

```rust
const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const LBRACKET: u8 = 0x5b;
const RBRACKET: u8 = 0x5d;
const BACKSLASH: u8 = 0x5c;

// Matches da_filter's HOLD_MAX discipline: a candidate that never terminates is
// discarded rather than grown without bound.
const CAND_MAX: usize = 2048;

/// Payload for the `terra:dev-server` event. `id` is the pty id, matching how
/// `AgentSignal` identifies its session.
#[derive(Clone, serde::Serialize)]
pub struct DevServerSignal {
    pub id: u32,
    pub url: String,
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    /// Accumulating (or ignoring) ordinary bytes.
    Ground,
    /// Saw ESC; the next byte decides which sequence form this is.
    Esc,
    /// Inside `ESC [ ... final`, where final is 0x40..=0x7e.
    Csi,
    /// Inside `ESC ] ... BEL` or `ESC ] ... ESC \`.
    Osc,
    /// Saw ESC while inside an OSC; `\` ends the stringterminator form.
    OscEsc,
}

/// Scans raw PTY output for loopback dev-server URLs.
///
/// Unlike `AgentDetector`, this reads ordinary output rather than OSC markers,
/// so it carries its own noise discipline: an escape sequence closes the
/// current candidate, and the last emitted URL is remembered so a repainting
/// TUI does not flood IPC. All further policy (per-session dedup, dismissal)
/// belongs to the frontend.
pub struct UrlDetector {
    state: State,
    cand: Vec<u8>,
    /// Set when the candidate overflowed CAND_MAX: keep consuming until the
    /// terminator, but do not evaluate.
    poisoned: bool,
    last: Option<String>,
}

impl UrlDetector {
    pub fn new() -> Self {
        UrlDetector {
            state: State::Ground,
            cand: Vec::with_capacity(64),
            poisoned: false,
            last: None,
        }
    }

    pub fn process<F: FnMut(&str)>(&mut self, input: &[u8], mut emit: F) {
        for &b in input {
            match self.state {
                State::Ground => {
                    if b == ESC {
                        self.flush(&mut emit);
                        self.state = State::Esc;
                    } else if is_url_byte(b) {
                        if self.cand.len() >= CAND_MAX {
                            self.poisoned = true;
                            self.cand.clear();
                        }
                        if !self.poisoned {
                            self.cand.push(b);
                        }
                    } else {
                        self.flush(&mut emit);
                    }
                }
                State::Esc => match b {
                    LBRACKET => self.state = State::Csi,
                    RBRACKET => self.state = State::Osc,
                    ESC => {}
                    _ => self.state = State::Ground,
                },
                State::Csi => {
                    if (0x40..=0x7e).contains(&b) {
                        self.state = State::Ground;
                    }
                }
                State::Osc => match b {
                    BEL => self.state = State::Ground,
                    ESC => self.state = State::OscEsc,
                    _ => {}
                },
                State::OscEsc => match b {
                    BACKSLASH => self.state = State::Ground,
                    ESC => {}
                    _ => self.state = State::Osc,
                },
            }
        }
    }

    /// Evaluate and clear the pending candidate. A candidate still open when a
    /// chunk ends stays pending, so a URL split across reads still matches.
    fn flush<F: FnMut(&str)>(&mut self, emit: &mut F) {
        let poisoned = std::mem::replace(&mut self.poisoned, false);
        let cand = std::mem::take(&mut self.cand);
        if poisoned || cand.is_empty() {
            return;
        }
        let Some(url) = normalize(&cand) else {
            return;
        };
        if self.last.as_deref() == Some(url.as_str()) {
            return;
        }
        emit(&url);
        self.last = Some(url);
    }
}

/// Bytes allowed inside a candidate. Square brackets are included because the
/// `[::1]` literal needs them; quotes, parens and angle brackets are excluded
/// so prose wrapping a URL terminates it.
fn is_url_byte(b: u8) -> bool {
    matches!(b,
        b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9'
        | b'-' | b'.' | b'_' | b'~' | b':' | b'/' | b'?' | b'#'
        | b'[' | b']' | b'@' | b'!' | b'$' | b'&' | b'*' | b'+'
        | b',' | b';' | b'=' | b'%'
    )
}

/// Returns the normalized URL if `cand` is a loopback dev-server URL.
fn normalize(cand: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(cand).ok()?;
    let (scheme, rest) = if let Some(r) = s.strip_prefix("http://") {
        ("http://", r)
    } else if let Some(r) = s.strip_prefix("https://") {
        ("https://", r)
    } else {
        return None;
    };

    // Split host from the ":port[/path]" tail. IPv6 literals carry their own
    // brackets, so scan past the closing bracket before looking for the colon.
    let (host, after_host) = if let Some(tail) = rest.strip_prefix('[') {
        let close = tail.find(']')?;
        (&rest[..close + 2], &tail[close + 1..])
    } else {
        let end = rest.find(|c| c == ':' || c == '/')?;
        (&rest[..end], &rest[end..])
    };

    let host_out = match host {
        "localhost" | "127.0.0.1" | "[::1]" => host,
        // Servers print 0.0.0.0 to mean "all interfaces"; it will not load in
        // an iframe, so offer the loopback name instead.
        "0.0.0.0" => "localhost",
        _ => return None,
    };

    let port_and_path = after_host.strip_prefix(':')?;
    let digits_end = port_and_path
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(port_and_path.len());
    let digits = &port_and_path[..digits_end];
    if digits.is_empty() || digits.len() > 5 {
        return None;
    }
    let port: u32 = digits.parse().ok()?;
    if !(1..=65535).contains(&port) {
        return None;
    }

    let path = &port_and_path[digits_end..];
    if !path.is_empty() && !path.starts_with(['/', '?', '#']) {
        return None;
    }

    Some(format!("{scheme}{host_out}:{port}{path}"))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --locked url_detect`
Expected: PASS — 20 tests.

- [ ] **Step 6: Verify lint is clean**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`

`DevServerSignal` has no consumer until Task 2, so expect one `dead_code`
warning on it and nothing else. Add `#[allow(dead_code)]` directly above the
struct to get a clean run; Task 2 Step 4 removes it once the consumer exists.

`UrlDetector::new()` without a `Default` impl mirrors `DaFilter` and
`AgentDetector`, which both pass this same lint gate — do not add one.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/modules/pty/url_detect.rs src-tauri/src/modules/pty/mod.rs
git commit -m "feat(pty): add loopback dev-server URL detector"
```

---

### Task 2: Wire the detector into the PTY reader thread

**Files:**
- Modify: `src-tauri/src/modules/pty/session.rs:11-16` (imports and event const), `:184-185` (construction), `:195-197` (reader loop)

**Interfaces:**
- Consumes: `UrlDetector::new()`, `UrlDetector::process(&[u8], FnMut(&str))`, `DevServerSignal { id, url }` from Task 1.
- Produces: Tauri event `"terra:dev-server"` with payload `{ id: number, url: string }`.

- [ ] **Step 1: Add the import and event const**

In `src-tauri/src/modules/pty/session.rs`, change lines 11-16 from:

```rust
use super::agent_detect::AgentDetector;
use super::da_filter::DaFilter;
use super::shell_init;
use crate::modules::workspace::WorkspaceEnv;

const AGENT_EVENT: &str = "terra:agent-signal";
```

to:

```rust
use super::agent_detect::AgentDetector;
use super::da_filter::DaFilter;
use super::shell_init;
use super::url_detect::{DevServerSignal, UrlDetector};
use crate::modules::workspace::WorkspaceEnv;

const AGENT_EVENT: &str = "terra:agent-signal";
const DEV_SERVER_EVENT: &str = "terra:dev-server";
```

- [ ] **Step 2: Construct the detector in the reader thread**

In the same file, change lines 184-185 from:

```rust
            let mut da_filter = DaFilter::new();
            let mut agent_detect = AgentDetector::new();
```

to:

```rust
            let mut da_filter = DaFilter::new();
            let mut agent_detect = AgentDetector::new();
            let mut url_detect = UrlDetector::new();
```

- [ ] **Step 3: Scan each chunk**

In the same file, change lines 195-197 from:

```rust
                        agent_detect.process(&buf[..n], |t| {
                            let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
                        });
```

to:

```rust
                        agent_detect.process(&buf[..n], |t| {
                            let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
                        });
                        url_detect.process(&buf[..n], |url| {
                            let _ = app_reader.emit(
                                DEV_SERVER_EVENT,
                                DevServerSignal { id, url: url.to_string() },
                            );
                        });
```

- [ ] **Step 4: Remove the dead-code allow if you added one**

If Task 1 Step 6 required `#[allow(dead_code)]` on `DevServerSignal`, delete that attribute now — the type has a consumer.

- [ ] **Step 5: Verify it builds and lints clean**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: no warnings.

Run: `cd src-tauri && cargo test --locked`
Expected: PASS — the full Rust suite, including Task 1's 20 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/pty/session.rs src-tauri/src/modules/pty/url_detect.rs
git commit -m "feat(pty): emit terra:dev-server on detected loopback URLs"
```

---

### Task 3: Frontend store and pure reducers

Pure TypeScript. No React, no wiring — this task is complete and testable on its own.

**Files:**
- Create: `src/modules/preview/lib/devServerStore.ts`
- Test: `src/modules/preview/lib/devServerStore.test.ts`

**Interfaces:**
- Consumes: the `{ id, url }` event payload shape from Task 2.
- Produces:
  - `export type DevServerEntry = { candidate: string | null; dismissed: string | null }`
  - `export function nextEntry(entry: DevServerEntry | undefined, url: string): DevServerEntry | null`
  - `export function chipLabel(url: string): string`
  - `export const useDevServerStore` — zustand store with `byLeaf: Record<number, DevServerEntry>`, `detect(leafId, url)`, `dismiss(leafId)`, `clear(leafId)`
  - `export function ensureDevServerListener(resolveLeaf: (ptyId: number) => number | null): void`
  - `export function setDevServerOpener(open: (url: string) => void): void`
  - `export function openDevServer(leafId: number): void`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/preview/lib/devServerStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chipLabel, nextEntry } from "./devServerStore";

describe("nextEntry", () => {
  it("sets a candidate on a first detection", () => {
    expect(nextEntry(undefined, "http://localhost:5173")).toEqual({
      candidate: "http://localhost:5173",
      dismissed: null,
    });
  });

  it("ignores a URL the user already dismissed", () => {
    const entry = { candidate: null, dismissed: "http://localhost:5173" };
    expect(nextEntry(entry, "http://localhost:5173")).toBeNull();
  });

  it("prompts for a different URL even after a dismissal", () => {
    const entry = { candidate: null, dismissed: "http://localhost:5173" };
    expect(nextEntry(entry, "http://localhost:6006")).toEqual({
      candidate: "http://localhost:6006",
      dismissed: "http://localhost:5173",
    });
  });

  it("is a no-op when the candidate is already showing", () => {
    const entry = { candidate: "http://localhost:5173", dismissed: null };
    expect(nextEntry(entry, "http://localhost:5173")).toBeNull();
  });

  it("supersedes an undismissed candidate with a newer URL", () => {
    const entry = { candidate: "http://localhost:5173", dismissed: null };
    expect(nextEntry(entry, "http://localhost:8000")).toEqual({
      candidate: "http://localhost:8000",
      dismissed: null,
    });
  });
});

describe("chipLabel", () => {
  it("shows host and port", () => {
    expect(chipLabel("http://localhost:5173")).toBe("localhost:5173");
  });

  it("drops the path", () => {
    expect(chipLabel("http://127.0.0.1:8000/docs")).toBe("127.0.0.1:8000");
  });

  it("keeps the ipv6 literal readable", () => {
    expect(chipLabel("http://[::1]:4321")).toBe("[::1]:4321");
  });

  it("falls back to the raw string when the URL will not parse", () => {
    expect(chipLabel("not a url")).toBe("not a url");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test devServerStore`
Expected: FAIL — `Failed to resolve import "./devServerStore"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/preview/lib/devServerStore.ts`:

```ts
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

type DevServerSignal = { id: number; url: string };

export type DevServerEntry = {
  /** URL currently offered by the chip, or null when nothing is offered. */
  candidate: string | null;
  /** Last URL the user dismissed. Sticky for the life of the PTY session. */
  dismissed: string | null;
};

/** Next entry state for a detection, or null when nothing should change.
 * Pure so the policy stays unit-testable without React or Tauri. */
export function nextEntry(
  entry: DevServerEntry | undefined,
  url: string,
): DevServerEntry | null {
  const dismissed = entry?.dismissed ?? null;
  // The user already answered for this URL; re-asking is the nagging the chip
  // exists to avoid. A different URL always prompts.
  if (url === dismissed) return null;
  if (entry?.candidate === url) return null;
  return { candidate: url, dismissed };
}

/** `host:port` for chip display. The path is dropped: it would widen the chip
 * without helping the user decide. */
export function chipLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type DevServerStore = {
  byLeaf: Record<number, DevServerEntry>;
  detect: (leafId: number, url: string) => void;
  dismiss: (leafId: number) => void;
  clear: (leafId: number) => void;
};

export const useDevServerStore = create<DevServerStore>((set) => ({
  byLeaf: {},
  detect: (leafId, url) =>
    set((s) => {
      const next = nextEntry(s.byLeaf[leafId], url);
      if (next === null) return s;
      return { byLeaf: { ...s.byLeaf, [leafId]: next } };
    }),
  dismiss: (leafId) =>
    set((s) => {
      const entry = s.byLeaf[leafId];
      if (!entry?.candidate) return s;
      return {
        byLeaf: {
          ...s.byLeaf,
          [leafId]: { candidate: null, dismissed: entry.candidate },
        },
      };
    }),
  clear: (leafId) =>
    set((s) => {
      if (!(leafId in s.byLeaf)) return s;
      const byLeaf = { ...s.byLeaf };
      delete byLeaf[leafId];
      return { byLeaf };
    }),
}));

let opener: ((url: string) => void) | null = null;
let bound = false;

/** Registered by App, which owns tab creation. */
export function setDevServerOpener(open: (url: string) => void): void {
  opener = open;
}

/** Opens the candidate for a leaf and clears the offer. */
export function openDevServer(leafId: number): void {
  const store = useDevServerStore.getState();
  const url = store.byLeaf[leafId]?.candidate;
  if (!url) return;
  store.dismiss(leafId);
  opener?.(url);
}

// The Rust detector reports per-pty; the chip renders per pane, so resolve
// pty -> leaf on arrival. `resolveLeaf` is injected rather than imported to
// keep this module free of a dependency on useTerminalSession.
export function ensureDevServerListener(
  resolveLeaf: (ptyId: number) => number | null,
): void {
  if (bound || typeof window === "undefined") return;
  bound = true;
  void listen<DevServerSignal>("terra:dev-server", (e) => {
    const leafId = resolveLeaf(e.payload.id);
    if (leafId === null) return;
    useDevServerStore.getState().detect(leafId, e.payload.url);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test devServerStore`
Expected: PASS — 9 tests.

- [ ] **Step 5: Verify types and lint**

Run: `pnpm check-types && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/preview/lib/devServerStore.ts src/modules/preview/lib/devServerStore.test.ts
git commit -m "feat(preview): add dev-server detection store and policy"
```

---

### Task 4: Bind the listener and clear on PTY exit

**Files:**
- Modify: `src/modules/terminal/lib/useTerminalSession.ts:362-367` (bind listener), `:538-548` (clear on exit)

**Interfaces:**
- Consumes: `ensureDevServerListener`, `useDevServerStore` from Task 3; the existing `leafIdForPty` (`useTerminalSession.ts:284`).
- Produces: store entries populated per leaf, and cleared when a shell exits.

- [ ] **Step 1: Add the import**

In `src/modules/terminal/lib/useTerminalSession.ts`, add alongside the existing imports:

```ts
import {
  ensureDevServerListener,
  useDevServerStore,
} from "@/modules/preview/lib/devServerStore";
```

- [ ] **Step 2: Bind the listener at module scope**

Immediately after the existing `ensureAgentActivityListener` block (lines 362-367), add:

```ts
ensureDevServerListener(leafIdForPty);
```

- [ ] **Step 3: Clear store state when the shell exits**

Change the `onExit` handler at lines 538-548 from:

```ts
      onExit: (code) => {
        s.shellExited = true;
        s.pty = null;
        s.pendingInput = "";
        s.commandRunning = false;
        const slot = getSlotForLeaf(leafId);
        if (slot) slot.term.options.disableStdin = true;
        scheduleHiddenRelease(leafId, s);
        if (s.callbacks.onExit) s.callbacks.onExit(code);
        else s.pendingExit = code;
      },
```

to:

```ts
      onExit: (code) => {
        s.shellExited = true;
        s.pty = null;
        s.pendingInput = "";
        s.commandRunning = false;
        // Detections die with the shell: a new shell starts clean, including
        // its dismissal memory.
        useDevServerStore.getState().clear(leafId);
        const slot = getSlotForLeaf(leafId);
        if (slot) slot.term.options.disableStdin = true;
        scheduleHiddenRelease(leafId, s);
        if (s.callbacks.onExit) s.callbacks.onExit(code);
        else s.pendingExit = code;
      },
```

- [ ] **Step 4: Verify types, lint, and the existing suite**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: no errors; all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/terminal/lib/useTerminalSession.ts
git commit -m "feat(terminal): bind dev-server listener and clear on shell exit"
```

---

### Task 5: The chip, its mount point, and the opener

**Files:**
- Create: `src/modules/preview/DevServerChip.tsx`
- Test: `src/modules/preview/DevServerChip.mount.test.ts`
- Modify: `src/modules/preview/index.ts`, `src/modules/terminal/PaneTreeView.tsx:1-10` and `:58`, `src/app/App.tsx`

**Interfaces:**
- Consumes: `useDevServerStore`, `chipLabel`, `openDevServer`, `setDevServerOpener` from Task 3; the existing `openPreviewTab` (`App.tsx:564`).
- Produces: `export function DevServerChip({ leafId }: { leafId: number })`.

- [ ] **Step 1: Write the failing source test**

Two mount sites would render duplicate chips for one detection and would not surface as a type error, so assert the count. Create `src/modules/preview/DevServerChip.mount.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("DevServerChip", () => {
  it("is mounted in exactly one place", () => {
    const sites = walk("src")
      .filter((p) => !p.endsWith("DevServerChip.tsx"))
      .filter((p) => /<DevServerChip\b/.test(readFileSync(p, "utf8")));
    expect(sites).toEqual(["src/modules/terminal/PaneTreeView.tsx"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test DevServerChip`
Expected: FAIL — received `[]`, expected `["src/modules/terminal/PaneTreeView.tsx"]`.

- [ ] **Step 3: Write the chip**

Create `src/modules/preview/DevServerChip.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { Cancel01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  chipLabel,
  openDevServer,
  useDevServerStore,
} from "./lib/devServerStore";

/** Offers the dev-server URL detected in this pane's output. Anchored to the
 * pane rather than the window so multiple panes can each hold their own offer.
 * Persists until dismissed, clicked, or superseded — no auto-expiry, since a
 * chip that vanishes on a timer is one the user misses while reading. */
export function DevServerChip({ leafId }: { leafId: number }) {
  const url = useDevServerStore((s) => s.byLeaf[leafId]?.candidate ?? null);
  const dismiss = useDevServerStore((s) => s.dismiss);
  if (!url) return null;
  return (
    <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-border/70",
          "bg-background/95 py-1 pr-1 pl-2.5 text-xs shadow-lg backdrop-blur-sm",
        )}
      >
        <button
          type="button"
          onClick={() => openDevServer(leafId)}
          className="flex items-center gap-1.5 font-medium text-foreground"
        >
          <HugeiconsIcon
            icon={Globe02Icon}
            size={14}
            strokeWidth={1.75}
            className="text-primary"
          />
          <span>Preview {chipLabel(url)}</span>
        </button>
        <button
          type="button"
          onClick={() => dismiss(leafId)}
          aria-label="Dismiss dev server preview"
          className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Export it**

Change `src/modules/preview/index.ts` from:

```ts
export { PreviewStack } from "./PreviewStack";
export type { PreviewPaneHandle } from "./PreviewPane";
```

to:

```ts
export { setDevServerOpener } from "./lib/devServerStore";
export { PreviewStack } from "./PreviewStack";
export type { PreviewPaneHandle } from "./PreviewPane";
```

`DevServerChip` is deliberately NOT exported here. `PaneTreeView` imports it by
path instead, so the terminal module does not pull `PreviewStack` and
`PreviewPane` in through the barrel just to render a chip.

- [ ] **Step 5: Mount it**

In `src/modules/terminal/PaneTreeView.tsx`, add to the imports at the top:

```tsx
import { DevServerChip } from "@/modules/preview/DevServerChip";
```

Then change line 58 from:

```tsx
        <DropOverlay leafId={node.id} />
```

to:

```tsx
        <DropOverlay leafId={node.id} />
        <DevServerChip leafId={node.id} />
```

- [ ] **Step 6: Register the opener in App**

In `src/app/App.tsx`, add `setDevServerOpener` to the existing import from `@/modules/preview` (add a new import line if App does not already import from that module). `useEffect` is already imported there. Then immediately after the `openPreviewTab` definition (which ends at line 574), add:

```tsx
  useEffect(() => {
    setDevServerOpener(openPreviewTab);
  }, [openPreviewTab]);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test DevServerChip`
Expected: PASS.

- [ ] **Step 8: Verify the whole suite, types, and lint**

Run: `pnpm test && pnpm check-types && pnpm lint`
Expected: all pass, no errors.

- [ ] **Step 9: Manual verification**

Run `pnpm tauri dev`, then in a terminal pane:

1. Run a dev server (`pnpm dev` in any project). Confirm the chip appears with the correct `host:port`.
2. Click it. Confirm a preview tab opens on that URL and loads.
3. Stop the server, re-run it. Confirm **no** second chip (the URL was dismissed by clicking).
4. Start a server on a different port. Confirm a chip appears for the new port.
5. Dismiss a chip with `×`, re-run the same server. Confirm no chip returns.
6. Run `cat` on a file containing `localhost:5173` with no scheme. Confirm no chip.
7. Split the pane, run servers on different ports in each. Confirm each pane shows its own chip.
8. Exit the shell (`exit`) and start a new one. Confirm a previously dismissed URL prompts again.

- [ ] **Step 10: Commit**

```bash
git add src/modules/preview/DevServerChip.tsx \
        src/modules/preview/DevServerChip.mount.test.ts \
        src/modules/preview/index.ts \
        src/modules/terminal/PaneTreeView.tsx \
        src/app/App.tsx
git commit -m "feat(preview): offer detected dev servers via a pane chip"
```

---

## Post-implementation

- [ ] Update `ROADMAP.md`: move **Smart Dev Server Auto-Docking** out of "Coming next" into Shipped under "Web Preview & Viewers". Note that the shipped behaviour is a prompt, not an auto-open, so word it as "Dev server detection with one-click preview" rather than "auto-docking".
