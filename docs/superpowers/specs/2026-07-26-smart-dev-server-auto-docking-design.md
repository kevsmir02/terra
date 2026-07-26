# Smart Dev Server Auto-Docking — Design

**Date:** 2026-07-26
**Status:** Approved, ready for implementation planning

## Problem

Starting a dev server and looking at it are two separate acts. The user runs
`pnpm dev`, reads the port out of the banner, opens a preview tab, and retypes
the URL — every time, for a URL the terminal just printed.

The preview pane already knows how to render a local dev server. It only lacks
the URL, which is sitting in the scrollback three lines up.

`PreviewAddressBar` currently mitigates this with a list of sixteen curated
ports (`PreviewAddressBar.tsx:31-48`). That is a guess at what the user is
running. The terminal has the actual answer.

## Goals

- Detect a dev server URL in PTY output and offer to preview it, without the
  user retyping anything.
- Never steal focus or open a surface the user did not ask for.
- Cost nothing when it is wrong — a false positive should be ignorable.

## Non-goals

Each of these is a plausible next request, deliberately excluded:

- **A preview dock panel.** The device dock exists because a device stream is
  something you watch *while* working. A preview is something you look at. It
  stays a tab, reusing `newPreviewTab` and `PreviewStack` unchanged.
- **Port probing.** No TCP connect to confirm the server is live before
  offering. The banner is evidence enough, and probing turns a passive reader
  into something that opens sockets.
- **A tab-bar indicator** for chips on inactive tabs.
- **An auto-open preference.** See "Trigger" below — auto-open is not the
  behaviour, so there is nothing to gate.
- **LAN address detection.** See "Match scope".
- **Persistence across restarts.** Detections die with the PTY session.

## Trigger

Detection surfaces a small dismissible chip anchored to the terminal pane that
produced the URL. Clicking it opens the preview tab. Dismissing it costs one
click and leaves no trace.

```
│ $ pnpm dev                       │
│   VITE ready in 412 ms           │
│   ➜ Local: http://localhost:5173 │
│                                  │
│  ╭─────────────────────────────╮ │
│  │ ◉ Preview localhost:5173  × │ │
│  ╰─────────────────────────────╯ │
```

### Alternatives considered

- **Auto-open the tab on first detection.** Zero friction for the common case,
  but `curl http://localhost:3000`, a printed README line, or an agent echoing
  a URL would all yank the user into a tab they did not ask for. The cost of a
  false positive has to stay near zero, and stealing focus is not near zero.
- **Auto-open behind a preference, default off.** Honest about the
  intrusiveness, but a feature that is off by default is a feature most users
  never discover.

## Architecture

Mechanism in Rust, policy in TypeScript. The Rust scanner answers exactly one
question — did a loopback URL appear in this byte stream — and every judgment
about whether to *show* anything stays in the frontend, which knows things the
reader thread does not: which pane is visible, what the user already dismissed.

```
PTY reader thread (session.rs)
  ├─ agent_detect.process(&buf[..n], ..)     existing
  ├─ url_detect.process(&buf[..n], ..)       NEW
  └─ da_filter.process(&buf[..n], ..)        existing
                    │
                    │  emit("terax:dev-server", { id: ptyId, url })
                    ▼
  devServerStore  (module-level, keyed by ptyId)
                    │  ptyIdForLeaf(leafId)
                    ▼
  DevServerChip  (rendered in PaneTreeView, beside DropOverlay)
                    │  click
                    ▼
  openPreviewTab(url)  →  existing newPreviewTab / PreviewStack
```

The reader thread already runs two byte-stream scanners per chunk and emits a
Tauri event (`terax:agent-signal`). This is a third instance of an established
pattern, not a new mechanism. `agentActivity.ts` already brokers that event
into a module-level store keyed by pty id; `devServerStore` mirrors it.

### Alternatives considered

- **Scanning in the frontend**, in `useTerminalSession`'s `onData`. No Rust
  changes and no new IPC event, but it puts a regex on the JS hot path for
  every chunk including keystroke echo, and needs its own cross-chunk buffering
  — reimplementing in TypeScript what the Rust scanners already do, with no
  existing precedent at that layer to follow.

## Detection — `src-tauri/src/modules/pty/url_detect.rs`

A byte state machine in the shape of `da_filter.rs`.

**Escape-aware.** Dev banners are coloured: Vite emits
`➜  Local:  \x1b[36mhttp://localhost:5173/\x1b[39m`. The scanner skips CSI and
OSC sequences rather than letting them terminate a candidate, so a URL wrapped
in colour codes still matches.

**Cross-chunk.** A 4 KB read can split `http://localh` / `ost:5173`. Partial
candidates carry in a held buffer, capped at 2048 bytes and then discarded —
the same runaway guard as `da_filter`'s `HOLD_MAX`.

**Candidate termination:** whitespace, control byte, escape, or any of
`"'()<>[]`.

### Match scope

Requires an explicit scheme. That single constraint removes the largest
false-positive class — bare `localhost:5173` appearing in prose.

| Input | Result |
|---|---|
| `http://localhost:5173` | match |
| `http://127.0.0.1:8000/` | match |
| `https://localhost:3000` | match |
| `http://[::1]:4321` | match |
| `http://0.0.0.0:8080` | match, rewritten to `http://localhost:8080` |
| `localhost:5173` | skip — no scheme |
| `http://192.168.1.5:5173` | skip — LAN |
| `http://localhost` | skip — no port |
| `http://localhost:99999` | skip — port out of range |

`0.0.0.0` is rewritten because servers print it to mean "listening on all
interfaces"; it is not loadable in an iframe. LAN addresses are skipped because
the same server is already reachable on loopback — matching them would detect
one `pnpm dev` twice and force dedup to key on port rather than URL.

**Repeat collapse.** The detector remembers only the last URL it emitted, so a
TUI repainting the same banner does not flood IPC. Everything beyond that —
per-session dedup, dismissal memory — belongs to the frontend.

### Alt-screen suppression, rejected

Gating detection while a TUI holds the alt screen was considered, since `vim`
displaying a URL would re-fire on every repaint. Alt-screen state lives in the
frontend mode machine (`block/lib/modeMachine.ts`); teaching the reader thread
about it would duplicate `agent_detect`'s OSC parsing for no gain. Repeat
collapse plus frontend dedup already make repaints inert.

## Frontend state — `src/modules/preview/lib/devServerStore.ts`

A module-level store keyed by pty id:

```ts
{ [ptyId]: { candidate: string | null; dismissed: string | null } }
```

Four transitions, all pure and testable without React:

| Event | Effect |
|---|---|
| URL detected, ≠ `dismissed` | `candidate = url` — chip appears |
| URL detected, = `dismissed` | ignored — repaint and re-run stay silent |
| User dismisses | `dismissed = candidate`, `candidate = null` |
| PTY exits | entry deleted — a new shell starts clean |

The exit transition hangs off the existing `onExit` handler already threaded
through `pty-bridge.ts` and `useTerminalSession`; no new lifecycle plumbing.

**Dismissal is sticky for the life of the PTY session.** Restarting the same
server on the same port after a dismissal does not re-prompt: the user already
answered for that URL, and re-asking is the nagging this design exists to
avoid. A *different* URL always prompts, so a real port change is never missed.

A newer URL supersedes an undismissed candidate. One chip per pane, always.

## Chip — `src/modules/preview/DevServerChip.tsx`

Rendered in `PaneTreeView` alongside `DropOverlay`, which establishes the
overlay pattern for pane-anchored UI (`PaneTreeView.tsx:82`).

The label shows `host:port` only — `Preview localhost:5173` — even when the
detected URL carries a path. The full URL is what opens; the path would push the
chip wide for no information the user needs to decide.

It persists until dismissed, clicked, or superseded. It does not auto-expire —
a chip that vanishes on a timer is a chip the user misses while reading the
error above it. If the owning pane sits on an inactive tab, the chip waits
there until the user returns; there is no tab-bar badge.

## Error handling

Most failure modes are the parser declining to emit: port out of range,
oversized candidate hitting the 2048-byte cap, non-loopback host, missing
scheme or port.

An event arriving for a pty id with no live leaf is dropped silently — a
session can be torn down while an event is in flight.

Iframe load failures remain existing `PreviewPane` behaviour. This feature
supplies a URL and nothing else.

## Testing

Consistent with how this repo tests these layers: pure logic plus source
inspection. There is no React testing library, so component behaviour cannot be
asserted directly.

**Rust** — `url_detect.rs` unit tests in the shape of `da_filter.rs`'s table:

- plain match; colour-wrapped URL; URL split across chunk boundaries
- `0.0.0.0` rewrite; `[::1]` bracket form; trailing-path and trailing-slash forms
- rejection: LAN address, missing scheme, missing port, port out of range
- runaway candidate flushed at the 2048-byte cap
- repeat collapse: same URL twice in one chunk and across chunks emits once

**TypeScript** — `devServerStore` reducer tests in vitest covering the four
transitions, plus supersede-by-newer-URL, in the style of `useDeviceDock`.

**Source test** — `DevServerChip` is mounted in exactly one place. Two mount
sites would render duplicate chips for one detection and would not surface as a
type error.

**Manual** — run `pnpm dev` in a pane, confirm the chip appears with the right
port, click it, confirm the preview tab opens and loads. Dismiss and re-run to
confirm no second prompt. Run a second server on a different port to confirm
the chip supersedes.

## Files

**New**

- `src-tauri/src/modules/pty/url_detect.rs`
- `src/modules/preview/lib/devServerStore.ts`
- `src/modules/preview/DevServerChip.tsx`

**Changed**

- `src-tauri/src/modules/pty/mod.rs` — module declaration
- `src-tauri/src/modules/pty/session.rs` — `DEV_SERVER_EVENT` const, detector
  construction, and one `process` call in the reader loop
- `src/modules/terminal/PaneTreeView.tsx` — render the chip
- `src/app/App.tsx` — wire `openPreviewTab` to the chip
- `src/modules/preview/index.ts` — exports
