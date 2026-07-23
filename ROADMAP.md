# Roadmap

Terra direction, what's shipped, what's coming, and what's deliberately out of scope.

## What Terra is

Terra is a fast, lightweight Terminal IDE (agentic development workspace) designed for developers who run CLI agent harnesses (Pi, OpenCode, Antigravity CLI, Claude Code) directly in the terminal. It pairs a native PTY backend with a modern UI: multi-tab terminals, an integrated code editor (CodeMirror 6), a file explorer, source control with git graph, and a web preview pane—eliminating the need to Alt-Tab between tools. Under 10 MB on disk. No telemetry.

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

### Editor

- [x] Multi-language support (TypeScript / JavaScript, Rust, Python, HTML / CSS, JSON, Markdown, Go, C / C++ / Java / C#, PHP)
- [x] Vim mode
- [x] Prebuilt & custom editor themes
- [x] **Hybrid Diagnostics & Lazy-Loaded LSP**: Default zero-RAM on-save diagnostics & statusbar indicator; ref-counted lazy LSP session lifecycle with idle shutdown.

### File Explorer

- [x] Icon theme with full file-type coverage
- [x] Fuzzy search, keyboard navigation, inline rename, context actions

### Git / Source Control

- [x] Source control panel (stage, commit, branch)
- [x] Git history with commit graph
- [x] Per-file diffs

### Web Preview & Viewers

- [x] Auto-detected local dev server preview
- [x] Image, PDF, and Markdown preview panes
- [x] Sandboxed iframe

### Device Preview

- [x] **Embedded Android Device Preview**: Dock and render running system Android emulator/AVD displays directly inside a Terra panel without bundling an emulator. Bundles `scrcpy-server.jar` (Apache-2.0); streams raw H.264 via ADB and decodes with MSE. Input via `adb shell input` in v1.

### Themes & Customization

- [x] Custom theme builder & bundled presets
- [x] Editor theme independent of app theme
- [x] Background images with adjustable opacity and blur
- [x] Customizable UI keybindings

### Platform Integration

- [x] macOS, Linux (.deb / .rpm / AppImage), Windows (NSIS), WSL
- [x] AUR (Arch)
- [x] Windows Explorer context-menu integration
- [x] Auto-updater
- [x] No telemetry

## Planned

### Coming next

- [ ] **Terminal <-> Editor Quick Bridge**: Click file/error paths in terminal output to jump straight to the line in CodeMirror; send paths from Explorer to active PTY.
- [ ] **Smart Dev Server Auto-Docking**: Sniff PTY output for `http://localhost:\d+` and auto-dock/open the web preview tab.

- [ ] **SSH & Remote Workspace Support**: PTY remote terminal management.
- [ ] **Inline Terminal Auto-Suggestions**: History-based terminal completions.
- [ ] **Persistent Session Restore**: Restore terminal scrollback & workspace state on reboot.

### Longer horizon

- [ ] Release automation (CHANGELOG, version bump, tag flow)
- [ ] Bundle optimization (lazy-load language packs, tree-shake)
- [ ] Selective TS → Rust migration where profiler shows wins
- [ ] Live filesystem update enhancements in explorer and editor

## Out of scope

- **Heavy IDE features.** Full language-server indexers, integrated debuggers, heavy refactoring engines.
- **Notebook and document workspaces.** Anything that turns Terax into a document host rather than a terminal IDE.
- **Package manager and toolchain UIs.** Use `npm`, `pip`, `cargo` and friends in the terminal directly.
- **Full web browser features.** Preview pane stays scoped to local dev servers and lightweight doc viewing.
- **Telemetry, analytics, accounts.** Terax stays offline-respectful.
