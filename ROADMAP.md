# Roadmap

Terra direction, what's shipped, what's coming, and what's deliberately out of scope.

## What Terra is

Terra is a fast, lightweight Terminal IDE (agentic development workspace) designed for developers who run CLI agent harnesses (Pi, OpenCode, Antigravity CLI, Claude Code) directly in the terminal. It pairs a native PTY backend with a modern UI: multi-tab terminals, an integrated code editor (CodeMirror 6), a file explorer, source control with git graph, a web preview pane, and an Android device preview dock—eliminating the need to Alt-Tab between tools. Under 10 MB on disk. No telemetry.

The product is opinionated: terminal-first, zero-bloat, CLI-agent workflow optimized, lightweight always, cross-platform without compromise.

## What Terra is not

- Not a full IDE replacement. Heavy IDE features that overlap with VS Code / Cursor / Zed are out of scope.
- Not a browser. Web preview exists for local dev servers and lightweight doc viewing only.
- Not a general workspace. Tools and formats that pull the product away from the terminal-first surface are out of scope.

## Themes

The themes below frame every scope decision.

1. **CLI-Agent First Workspace.** Integrated environment for running CLI agents alongside your editor, git, and web preview without Alt-Tabbing.
2. **Lightweight always.** 7-8 MB binary. Every dependency justified. Per-tab memory budget enforced.
3. **Terminal-first.** xterm.js correctness, WebGL rendering, PTY fidelity, TUI app compatibility are non-negotiable.
4. **Cross-platform parity.** macOS, Linux, Windows, WSL. No platform-specific exclusives.
5. **Security by default.** Path guards, trust gating, IPC sandboxing. Defaults safe out of the box.

## Shipped

### Terminal & Spaces

- [x] Multi-tab terminal with WebGL renderer
- [x] Native PTY backend (zsh, bash, pwsh, fish, cmd)
- [x] Split panes with tree serialization & layout restore
- [x] Shell integration (cwd, prompt markers)
- [x] Inline search, link detection, true-color
- [x] Drag and drop in terminal (files as quoted paths)
- [x] OSC 777 terminal agent detection & status notifications for CLI agents
- [x] WSL bridge as workspace environment
- [x] **Project Profiles & Auto-Launch**: Extended Spaces to save resizable panel split ratios (`panelSizes`) and auto-run startup commands (`startupCommands: ["pnpm dev", "pi"]`).
- [x] **Block-Mode Shell Input**: OSC 133-driven prompt/running/alt-screen mode machine backing a dedicated CodeMirror shell input bar, with block decorations and per-block output caps.
- [x] **History-Based Inline Suggestions**: Persisted command history with ghost-text completion, history popover, and filesystem path completion in the shell input.
- [x] Command palette with command history

### Editor

- [x] Multi-language support (TypeScript / JavaScript, Rust, Python, HTML / CSS, JSON, Markdown, Go, C / C++ / Java / C#, PHP)
- [x] Vim mode
- [x] Prebuilt & custom editor themes
- [x] **Hybrid Diagnostics & Lazy-Loaded LSP**: Default zero-RAM on-save diagnostics & statusbar indicator; ref-counted lazy LSP session lifecycle with idle shutdown.
- [x] **Live Filesystem Sync**: Explorer re-reads affected directories and the editor reloads open tabs on fs-watch events. A dirty buffer is never clobbered; instead the pane surfaces whether the file changed or was deleted on disk, with an explicit reload-or-recreate action.

### File Explorer

- [x] Icon theme with full file-type coverage
- [x] Fuzzy search, keyboard navigation, inline rename, context actions

### Git / Source Control

- [x] Source control panel (stage, commit, branch)
- [x] Git history with commit graph
- [x] Per-file diffs

### Web Preview & Viewers

- [x] Local dev server preview with one-click common-port presets
- [x] Dev server detection with one-click preview
- [x] Markdown preview pane with rendered/raw toggle
- [x] Inline image, PDF, video, and audio viewers for binary files
- [x] Sandboxed iframe

### Device Preview

- [x] **Embedded Android Device Preview**: Render running system Android emulator/AVD displays directly inside Terra without bundling an emulator. Bundles `scrcpy-server.jar` (Apache-2.0); streams raw H.264 via ADB and decodes with MSE.
- [x] **Android Emulator Device Preview Pane**: Resizable, collapsible right-hand device dock with persisted width, serial header, device picker, and stop control; the preview pane resets on device switch and gates not-yet-booted emulators.
- [x] **Binary Touch Control Bridge**: Low-latency scrcpy binary control protocol over a dedicated socket (multi-touch, scroll, keys), with `adb shell input` as the fallback when the control channel drops.
- [x] **1-Click AVD Launch**: List, boot, and stop system AVDs headless from the Devices panel with cross-platform Android SDK discovery and owned emulator lifecycle.

### Themes & Customization

- [x] Custom theme builder & bundled presets
- [x] Editor theme independent of app theme
- [x] Background images with adjustable opacity and blur
- [x] Customizable UI keybindings

### Build & Bundle

- [x] **Enforced Startup Bundle Budget**: Per-window eager-set measurement derived from the built HTML (entry script plus every `modulepreload`), gated in CI alongside `knip`. Replaces hand-maintained size-limit globs that under-reported the eager set by 43%.

### Platform Integration

- [x] macOS, Linux (.deb / .rpm / AppImage), Windows (NSIS), WSL
- [x] AUR (Arch)
- [x] Windows Explorer context-menu integration
- [x] Auto-updater
- [x] No telemetry

## Planned

### Coming next

- [ ] **Terminal <-> Editor Quick Bridge**: Click file/error paths in terminal output to jump straight to the line in CodeMirror; send paths from Explorer to active PTY.
- [ ] **Copy on Selection**: Opt-in, off by default. Writing the selection to the clipboard on mouse-up clobbers whatever the user had copied, since a webview cannot reach the X11 primary selection that makes this non-destructive on Linux.
- [ ] **Rebindable Terminal Keys**: Terminal copy, paste, and Shift+Enter are hardcoded in the xterm key handler and bypass the shortcut system that already covers the other 40 actions.
- [ ] **Shortcut Conflict Detection**: Binding a chord already claimed by another action silently shadows it; the shortcut editor should surface the clash while recording.
- [ ] **Relative Paths on Drop**: Dropping a file into a pane pastes its absolute path; paste it relative to that pane's shell cwd when the file sits under it, so the path stays short for the shell and for CLI agents.
- [ ] **SSH & Remote Workspace Support**: PTY remote terminal management.
- [ ] **Terminal Scrollback Restore**: Workspace, tab, and pane-tree state already restore on reboot; scrollback contents do not.

### Longer horizon

- [ ] Release automation: CHANGELOG generation and version bump. Tag-triggered multi-platform build and publish already ships in `release.yml`.
- [ ] Selective TS → Rust migration where profiler shows wins

## Out of scope

- **Heavy IDE features.** Full language-server indexers, integrated debuggers, heavy refactoring engines.
- **Notebook and document workspaces.** Anything that turns Terax into a document host rather than a terminal IDE.
- **Package manager and toolchain UIs.** Use `npm`, `pip`, `cargo` and friends in the terminal directly.
- **Full web browser features.** Preview pane stays scoped to local dev servers and lightweight doc viewing.
- **Telemetry, analytics, accounts.** Terax stays offline-respectful.
