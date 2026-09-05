# Roadmap

Direction for this fork: what it is, what is next, and what stays out. `TERRA.md` has the architecture and the definition of done.

## What Terra is

A lightweight, terminal-first IDE for a developer who runs agent harnesses (Claude Code, Codex, OpenCode and the like) in the terminal. The terminal is the product; the editor, explorer, source control, preview, language servers, and device dock exist so the agent's work can be read, verified, and touched up without leaving the window. Every surface beyond the terminal is on demand: dormant until opened, dormant again when closed. Lightweight is measured, not asserted: the eager startup bundle is budgeted per window and gated in CI, and language servers run under a memory watchdog.

Terra is developed, used, and released on Linux (Fedora day to day). The macOS and Windows code paths inherited from upstream have been removed; nothing in the tree targets another platform.

## Next

- Terminal to editor quick bridge: click file and error paths in terminal output to jump to the line in CodeMirror, and send paths from the explorer to the active PTY.
- Relative paths on drop: when a dropped file sits under the pane's shell cwd, paste the path relative to it so it stays short for the shell and for CLI agents.
- Terminal scrollback restore: workspace, tab, and pane-tree state already restore on relaunch; scrollback contents do not.
- SSH and remote workspaces.

## Maybe, later

- Release automation: changelog generation and version bump. Tag-triggered build and publish already ships in `release.yml`.
- Selective TypeScript to Rust migration where the profiler shows wins.

## Out of scope

- Heavy IDE features: project-wide indexers, integrated debuggers, refactoring engines.
- Notebook and document workspaces.
- Package manager and toolchain UIs. Use `npm`, `pip`, `cargo` and friends in the terminal.
- A general web browser. The preview pane stays scoped to local dev servers and lightweight doc viewing.
- Built-in AI. The harness runs in the terminal; Terra runs no models.
- Telemetry, analytics, accounts.
- macOS and Windows support work.
