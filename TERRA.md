# TERRA.md

Terra loads `TERRA.md` from the workspace root as agent memory (similar to AGENTS.md / CLAUDE.md). This file is also the project's living architecture doc - read it before making changes.

## Project

**Terra**: open-source terminal IDE. Tauri 2 + Rust (`portable-pty`) backend, React 19 + TypeScript + xterm.js (webgl) client.

- Frontend checks: `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm knip`, `pnpm audit` (CI runs `--prod` and the full tree as separate steps)
- Rust checks: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`, `cd src-tauri && cargo nextest run --locked` (local fallback: `cargo test --locked`), `cd src-tauri && cargo audit`

`pnpm lint` runs with `--error-on-warnings`: biome warnings fail the build, so a
deliberate exception needs a `// biome-ignore <rule>: <reason>` naming the reason,
not a growing warning count. Accepted Rust advisories live in
`src-tauri/.cargo/audit.toml` with their rationale; anything unlisted fails.

## Quality bar

Production-grade or it does not ship. Every change is judged against all of these, not just "it works":

- **Correctness**: edge cases, failure modes, concurrent access. No "works for now".
- **Performance**: ultra-lightweight is the product. ~7-8 MB bundle, high-performance terminal. For every change ask: how much RAM it costs, whether it adds IPC round-trips or redundant requests, whether it triggers extra re-renders or wasted work, whether it pulls a heavy dependency. Unused features consume zero resources.
- **Security**: no critical security holes. Validate at every boundary (IPC, fs, network).
- **UI/UX**: polished, professional, premium. Every state and detail considered.
- **Architecture**: new or changed logic lives in pure, dependency-light functions (functional core); tauri commands and React components stay thin (imperative shell). Keeps it testable without a later rewrite.

Run the checks listed under **Project** before claiming done.

A change to a core subsystem (terminal/shell spawn, workspace auth, git, fs, IPC) needs a test that locks the invariant.

## Conventions

- **Comments**: default to none, the code should explain itself. If genuinely needed, 1-2 lines on *why*, never *what*.
- **No em-dash** anywhere: code, comments, commits, docs.
- **No emojis** anywhere.
- **No AI attribution in commits**: never add `Co-Authored-By:` for Claude or any assistant, and never a "Generated with Claude Code" line. Earlier commits carry these; do not copy them when matching commit style. A `commit-msg` hook strips them as a backstop.
- **Imports**: always `@/...` on the frontend, never relative across modules.
- **pnpm only**, never npm/npx/yarn.

## Architecture

### Two-process model

**Rust (`src-tauri/`)** owns all OS access. The webview never touches the FS, processes, or shells directly - everything goes through `invoke()` calls to commands registered in `src-tauri/src/lib.rs`:

- `pty::pty_*` - long-lived interactive PTY sessions (xterm ↔ portable-pty), managed by `PtyState` (`RwLock<HashMap<id, Session>>`). Output streams via a Tauri `Channel<PtyEvent>`.
- `fs::tree::*` (`fs_read_dir`, `list_subdirs`), `fs::file::*` (`fs_read_file`, `fs_write_file`, `fs_stat`, `fs_canonicalize`, `fs_allow_asset`), `fs::mutate::*` (`fs_create_file`, `fs_create_dir`, `fs_rename`, `fs_delete`, `fs_copy`), `fs::watch::*` (`fs_watch_add`, `fs_watch_remove`): file explorer + editor IO.
- `fs::search::*` (`fs_search`, `fs_list_files`), `fs::grep::*` (`fs_grep`, `fs_grep_interactive`, `fs_glob`): fuzzy file finder + content search (powered by `ignore` + `grep-*` crates).
- `git::commands::*`: full source-control surface (`git_status`, `git_diff`, `git_diff_content`, `git_stage`, `git_unstage`, `git_discard`, `git_commit`, `git_fetch`, `git_pull_ff_only`, `git_push`, `git_log`, `git_show_commit`, `git_commit_files`, `git_commit_file_diff`, `git_panel_snapshot`, `git_resolve_repo`, `git_remote_url`, `git_list_branches`, `git_checkout_branch`). All gated through the workspace authorization registry.
- `workspace::*`: `workspace_authorize` / `workspace_current_dir` (the authorization registry) plus the WSL bridge (`wsl_list_distros`, `wsl_default_distro`, `wsl_home`).
- `shell::shell_run_command`: one-shot command execution for internal tooling (formatters, `git` helpers). Runs through the login shell with a clamped timeout and a 256 KB output cap; cwd goes through `authorize_spawn_cwd`, and the **canonical** path it returns is what the child spawns into.
- `history::*` (`history_suggest`, `history_commands`, `history_record`, `history_list`): shell-history-backed command suggestions.
- `device::commands::*` (`device_list`, `device_list_avds`, `device_launch_avd`, `device_stop_avd`, `device_list_system_images`, `device_create_avd`, `device_open`, `device_close`, `device_send_touch`, `device_send_key`, `device_send_scroll`, `device_input_tap`, `device_input_swipe`, `device_input_key`, `device_screen_size`): Android device/emulator mirroring. See **Device module** below.
- `updater::*` (`updater_package_kind`, `updater_download`, `updater_install`): package-aware update flow around `tauri-plugin-updater`.
- `services::*` (`services_status`, `services_up`, `services_down`, `services_delete_data`): optional local hosting services for databases, mail, web, and project sites.
- `agent::*` (`agent_enable_hooks`, `agent_hooks_status`), `get_launch_dir` / `get_launch_files` (drained-once CLI launch target).
- `lsp::*` (`lsp_detect`, `lsp_host_pid`, `lsp_resolve_root`, `lsp_spawn`, `lsp_send`, `lsp_kill`): language server process host. Dumb JSON-RPC pipe: Content-Length framing + process lifecycle in Rust (`lsp/framing.rs`, pure + tested), protocol intelligence on the frontend. Spawn cwd gated through the workspace registry; binaries resolve via the captured login-shell env (`lsp/env.rs`, GUI apps get a bare PATH on macOS); root detection walks up to markers but never to or above `$HOME`. Servers run in their own process group on Unix and are group-killed (cargo check / proc-macro children die with the server); Windows children get a `proc::job::ProcessJob` (kill-on-close, shared with pty). All sessions killed on `RunEvent::Exit`.
- `open_settings_window`: separate webview window for Settings (optional `tab` arg deep-links a section).
- `migrate::migrate_legacy_app_dirs`: not a command. Runs before the builder, because the store and webview open their identifier-scoped trees during plugin init.

### Workspace authorization

`WorkspaceRegistry` (`modules/workspace.rs`) is the single answer to "may the webview touch this path". Everything that reaches the disk or spawns a process goes through it - **fs, git, PTY/shell spawn, LSP spawn, and the asset protocol**.

Roots are added only by a user gesture: app launch (cwd + every CLI file argument), `$HOME` at bootstrap, a terminal `cd` (OSC 7 re-authorizes), a space root typed in Settings, and a real OS drag-drop (registered from the `DragDrop` window event in `lib.rs`, *not* from the paths JS hands back). Registering the dropped path itself rather than its parent keeps the grant as narrow as the gesture.

Four gates in `fs/mod.rs`, and picking the wrong one is a real bug:

| Gate | Use for | Behaviour |
| --- | --- | --- |
| `authorized_read` | reads, directory walks | canonicalizes via the registry's TTL cache |
| `authorized_write` | writes to an existing path | canonicalizes fresh (a stale cache entry is the symlink-swap window) |
| `authorized_entry` | delete, rename source, `fs_stat` | authorizes the **parent**; never resolves the final component, so a symlink is acted on as itself |
| `authorized_new` | create, rename/copy target | authorizes the nearest existing ancestor, re-joins the missing tail |

Canonicalizing first is what makes the check mean anything: `..` collapses and symlinks resolve, so the root is compared against the real target rather than the spelling. `is_authorized` uses `Path::starts_with`, which is component-wise - never swap it for a string prefix.

Commands stay thin shells over a core taking `&WorkspaceRegistry`, so the gate is unit-testable without a Tauri runtime (`fs::mutate::create_file`, `fs::grep::grep`, ...). The invariants are locked in `fs::authorization_tests`.

The asset protocol (`asset://`, used for image/video/audio/PDF previews) has an **empty static scope**. `fs_allow_asset` grants one already-authorized file at a time via `asset_protocol_scope().allow_file()`. A blanket `"**"` scope would hand the webview arbitrary file reads over a channel this registry never sees.

### PTY shell integration

PTY shells are bootstrapped via injected init scripts in `src-tauri/src/modules/pty/scripts/`:

- **Unix** (`zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh`, `bashrc.bash`) for zsh/bash, plus `init.fish` installed to `~/.config/fish/conf.d/terra.fish` for fish. Emit OSC 7 (cwd) and OSC 133 A/B/C/D (prompt boundaries + exit code) so the host can track cwd and detect command boundaries without re-parsing the prompt. Fish 4.0+ writes its own OSC 133 prompt markers; Terra sets `fish_features=no-mark-prompt` and re-asserts its own prompt via `-C` to avoid doubling.
- **Windows** (`profile.ps1`) - passed via `pwsh -NoLogo -NoExit -ExecutionPolicy Bypass -File <path>`. Wraps the user's existing `prompt` function (after their `$PROFILE` runs) to emit OSC 7 + OSC 133 A/B/D. Shell priority: `pwsh.exe` (PS 7+) → `powershell.exe` (PS 5.1) → `cmd.exe` (no integration). cwd is normalized to backslashes before being passed to ConPTY (`CreateProcessW` misbehaves with forward-slash cwd).

`pty/shell_init.rs` is split into `#[cfg(unix)]` / `#[cfg(windows)]` modules - keep new platform-specific code in the right cfg arm.

ConPTY on Windows requires `SPAWN_LOCK` (Mutex) around `openpty + spawn_command` in `session.rs`. Concurrent spawns leave one of the resulting PTYs with a stalled output pipe. Don't remove the lock without verifying first-tab stability under fast tab spam.

Each ConPTY child is also assigned to a per-session **Job Object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`pty/job.rs`). When the Job HANDLE drops - clean shutdown, panic, or even SIGKILL'd Terra process - the kernel kills every descendant of the shell (e.g. `npm run dev` spawned from inside pwsh). Without this Windows orphans the entire process subtree because `TerminateProcess` only kills the immediate child. macOS/Linux rely on `Drop for Session → killer.kill()`; on dev-`Ctrl-C` of `cargo run` destructors don't fire and orphans are possible there too - acceptable for now since dev only.

### Device module (`src-tauri/src/modules/device/`)

Android device and emulator mirroring, driven by the platform-tools on PATH. `adb.rs` resolves `adb` / `emulator` / `avdmanager` and parses their output; `server.rs` pushes and starts the bundled `scrcpy-server-*.jar` (shipped via `bundle.resources`); `session.rs` owns a live mirror session (adb forward + video socket) and `remux.rs` repackages the raw H.264 stream into fMP4 for MSE playback in the webview; `control.rs` encodes touch/key/scroll control messages; `state.rs` holds sessions and Terra-launched AVDs, all killed on `RunEvent::Exit` (AVDs the user started elsewhere are left alone).

Every process is spawned argv-style, never through a shell. Two values arrive from IPC and are validated before they reach `adb`: AVD names via `is_safe_avd_name`, and serials via `ensure_safe_serial` (`emulator-5554` and `host:port` shapes only, no leading `-`). Coordinates are `u32`, so they cannot carry an argument. Adding a command that takes a serial means calling `ensure_safe_serial` on it.

### Concurrency

`modules/sync.rs` provides `lock_or_recover` / `read_or_recover` / `write_or_recover`. Use them for all long-lived shared state (`PtyState`, `WorkspaceRegistry`, `DeviceState`, `LspState`, ...) instead of `.lock().unwrap()`. A panic while a lock is held poisons it for the rest of the process, which would turn one bad frame into a permanently dead subsystem; every value behind these locks is plain data, so recovering the guard is strictly better than propagating the panic to every later caller.

### Frontend (`src/`)

Single-window React app. Path alias `@/*` → `src/*`. Tabs are a tagged union (`kind`: `terminal` | `editor` | `preview` | `markdown` | `git-diff` | `git-history` | `git-commit-file`) and **not** unmounted on switch - they're hidden via `invisible pointer-events-none` so PTYs and dev servers keep streaming in the background.

`App.tsx` wires modules together - keep it a coordinator. New features go inside the appropriate `modules/<area>/`.

### Module layout (`src/modules/`)

Each module is self-contained, exports a thin barrel via `index.ts`, and owns its hooks under `lib/`.

- **terminal/** - `TerminalStack` keeps one mounted xterm per tab via `useTerminalSession` + `pty-bridge`. `osc-handlers.ts` parses OSC 7 (with Windows drive-letter normalization: `/C:/Users/foo` → `C:/Users/foo`) and OSC 133 markers. The xterm color palette is driven by the central theme engine (`modules/theme`), not a local table. Renderer slots are pooled (`rendererPool.ts`, max 5): a hidden leaf with a foreground job (OSC 133 C..D, agent signal, or `pty_has_foreground_job`) keeps its live grid parked with rendering paused via `display:none`; an idle hidden leaf releases its slot but the buffer is retained and serialized lazily only when another leaf steals it. The `DormantRing` (1 MiB, no terminal reset on overflow) buffers bytes only for leaves whose slot was stolen or never bound. Never serialize a leaf that is mid-command: replaying incremental TUI repaints over a snapshot is what used to wipe Claude Code.
- **editor/** - CodeMirror 6 stack (`EditorStack` mirrors `TerminalStack`). `extensions.ts` configures language modes; supports vim mode. Buffers live in LF space and the original EOL (`lib/eol.ts`, majority-vote detection) is restored on save; indent unit/tab size are detected per file (`lib/indent.ts`) via a per-pane compartment. Saves are conflict-checked against the disk mtime returned by `fs_read_file`/`fs_write_file` (mismatch → warning toast with explicit Overwrite, never silent last-writer-wins); external format-on-save only applies the disk read-back if the doc is unchanged since the save snapshot. Files over 10 MB offer "Open anyway" (hard cap 50 MB, `force` arg); above 4 MB syntax highlighting and LSP stay off. Cmd-F routes to CodeMirror's own search panel (find/replace/regex) when an editor tab is active, Ctrl-G opens go-to-line; both panels styled in `chromeTheme.ts`. Format-on-save formatters live in `lib/externalFormat.ts` (`FORMATTERS` registry: biome, prettier, ruff, rustfmt, gofmt, clang-format, shfmt, zig fmt, plus a custom `{file}` command template); `resolveFormatter` applies per-language overrides (`editorFormatterByLang`) over the global default, and a global external default only runs on languages its tool understands. Diff panes resolve the language before mounting CodeMirror: a late compartment reconfigure leaves the merge view's deleted-chunk widgets unhighlighted.
  Editor code size is stored separately as `editorFontSize` and does not affect `terminalFontSize`.
- **explorer/** - file tree with Material/Catppuccin icons (`iconResolver.ts`), fuzzy search, keyboard nav, inline rename, context actions. Backslash-aware `basename`.
- **preview/** - auto-detected dev-server preview tab (status-bar pill suggests opening when a localhost URL is detected).
- **tabs/** - `useTabs` is the source of truth for tab list + active id. `useWorkspaceCwd` derives explorer root + inherited cwd for new tabs from active tab. `basename` splits on both `/` and `\`.
- **header/** - top bar + inline search (`SearchInline` adapts to terminal vs editor via `SearchTarget`). `WindowControls` rendered when `USE_CUSTOM_WINDOW_CONTROLS` is true (Linux + Windows; macOS uses native traffic lights).
- **statusbar/** - bottom bar, `CwdBreadcrumb` (handles Unix paths, Windows drive letters, and home `~` segments via `pathUtils.segmentsFromCwd`).
- **shortcuts/** - keymap registry (`shortcuts.ts`) + `useGlobalShortcuts`. Handlers live in `App.tsx` and are passed in by id (`tab.new`, …). `metaKey || ctrlKey` for cross-platform Cmd/Ctrl.
- **settings/** - settings store (`store.ts` via `tauri-plugin-store`), preferences hook, settings window opener. The Settings window includes a Services tab.
- **services/** - optional local hosting stack status and controls for databases, mail, web, and project sites.
- **sidebar/** - activity bar + collapsible side panels (explorer, source control, git history).
- **source-control/** - git status / stage / commit panel and diff workflow.
- **git-history/** - commit graph rail, refs, per-commit file diffs.
- **lsp/** - opt-in language server support, zero cost until enabled (no process, no PATH check, nothing in the eager bundle beyond a 14.5 kB shell). Statusbar pill offers Enable (binary found) or Install (with copyable command) per language; activation persists as `lspActivation` in the settings store (`enabled`/`dismissed`/unset). `sessionManager.ts` keys sessions by (server, workspace root), refcounts open docs, idle-kills after 3 min, and crash-backoffs (cooldown before respawn; 3 in 5 min → give up + toast with the server's stderr tail). Resource invariants: **no root marker → no session** (a dirname fallback once spawned a server per directory and burned GBs), hard cap of 4 sessions per server, lean per-preset `initializationOptions` (rust-analyzer: `cachePriming` off + bounded `lru`; tsls: `maxTsServerMemory`). Client is `codemirror-languageserver` behind a lazy import, subclassed (`lib/client.ts`) to add didClose/didSave/shutdown, `textDocument/references` (Shift-F12; multi-result definitions and references share the `locationsPanel.ts` picker) and the publishDiagnostics capability the lib forgets (tsls sends no diagnostics without it); `lib/transport.ts` bridges to the Rust pipe and answers server-to-client requests the lib ignores. `vscode-languageserver-protocol` is aliased to a 4-enum shim in vite.config.ts (~117 kB saved). Presets: typescript, rust-analyzer, pyright, ruff, gopls and more; custom stdio servers via Settings. Several presets can claim one language (pyright and ruff both take `py`): `serverForLanguage` prefers the enabled candidate, so enabling ruff while pyright is unset or dismissed routes Python to ruff. WSL workspaces excluded for now.
- **markdown/** - markdown preview renderer (backs the `markdown` tab kind).
- **workspace/** - workspace environment switching (Local + WSL distros).
- **theme/** - custom theme engine (no `next-themes`). `ThemeProvider` + `applyTheme` write CSS variables; built-in presets in `themes/` (terra-default, nothing, stardew, gameboy, kanagawa, kanagawa-dragon, gruvbox, windows-xp), each optionally declaring an `editorTheme` pairing consumed by `resolveEditorTheme` (see editor/). User themes via `customThemes.ts` + `validateTheme.ts`. Syntax and status colours are derived from each theme's ANSI palette (`derive.ts` + `oklab.ts`, both pure) rather than authored, so a theme colours the editor and the git surfaces without declaring anything extra. Optional background image via `bgImageStore.ts` + `SurfaceLayer`. **Authoring a theme or adding a theme token: read `THEME.md` first.**
- **updater/** - auto-updater UI built on `tauri-plugin-updater`.
- **agents/** - agent notifications + management for terminal coding-agents (Claude Code, Codex, Gemini CLI, Pi). Shared store (`store/agentStore.ts`: terminal `sessions` + `notifications`) and a shared router (`lib/route.ts`: suppress when focused-and-visible, OS-notify when unfocused, in-app Sonner toast when focused-but-hidden) feed the header `NotificationBell` (management surface, per-agent hook enable rows). Toasts use Sonner (`components/ui/sonner.tsx`) themed via the central engine; `lib/agentIcon.tsx` renders the per-agent brand mark (Pi logo, Claude/ChatGPT/Gemini hugeicon). Terminal detection is Rust-side (`pty/agent_detect.rs`) on the PTY reader's byte filter, armed on `OSC 133;C;<cmd>` or self-armed by the marker, emitting `terra:agent-signal` transitions (`started`/`working`/`attention`/`finished`/`exited`) driven only by OSC sequences (never raw output, so a repainting TUI never flaps) - zero cost when no agent runs. All terminal agents converge on the same `OSC 777` marker the detector reads, installed via `agent_enable_hooks(agent)` / `agent_hooks_status(agent)` in `modules/agent.rs` (data-driven `AgentSpec` for JSON-hook agents plus a Terra-owned Pi extension; atomic writes, foreign configuration preserved, idempotent; gated on `TERRA_TERMINAL`). Delivery differs because only Claude's hook protocol can return terminal bytes in the hook *response*: **Claude** (`~/.claude/settings.json`, `UserPromptSubmit`/`Notification`/`Stop`) returns the marker via the `terminalSequence` field (legacy 3-field `notify;Terra;<event>`). **Codex** (`~/.codex/hooks.json`, `UserPromptSubmit`/`PermissionRequest`/`Stop`) and **Gemini** (`~/.gemini/settings.json`, `BeforeAgent`/`Notification`/`AfterAgent`, `matcher:"*"`) can't, so the hook *command* emits the 4-field `notify;Terra;<agent>;<event>` marker itself (`printf > /dev/tty` on Unix, or `terra __terra_notify` writing to `CONOUT$` after `AttachConsole` on Windows) and prints `{}` as a JSON stdout no-op (Codex's `Stop` and Gemini both reject empty/non-JSON stdout). **Pi** (`~/.pi/agent/extensions/terra-notifications.ts`) uses `agent_start`/`agent_settled` extension events and writes its named marker directly to stdout. The agent-named marker lets a self-arm name the right agent when no preexec fired (bash/tmux/Windows). The Terra agent path is `ai/components/LocalAgentNotificationsBridge.tsx`, mapping `chatStore.agentMeta` (`awaiting-approval`→attention, busy→idle→finished, `error`) into the same router.
- **command-palette/** - modal command palette (`CommandPalette.tsx`, `commands.ts`) for actions and navigation.
- **spaces/** - workspace spaces/projects (name, root, env, color, per-space tab persistence) via `useSpaces` and `SpaceSwitcher`.

### UI conventions

- **shadcn/ui** is configured (`components.json`, style `radix-luma`, base `mist`, icon lib **hugeicons**). Primitives in `src/components/ui/` - don't hand-edit; re-run `pnpm dlx shadcn add` to upgrade.

- Animation: `motion` (Framer Motion successor). Resizable layout: `react-resizable-panels`.
- Path imports: always `@/…`, never relative across modules.
- Cross-platform paths: anywhere a path may originate from OSC 7, the explorer, or the OS, normalize separators with `.split(/[\\/]/)` rather than `.split("/")`.
- Canonical path form on the frontend is **forward-slash**. `homeDir()` returns backslashes on Windows; convert at the boundary (App.tsx setHome). OSC 7 already arrives as forward-slash. Equal canonical strings keep `useFileTree` from wiping its tree and flashing the explorer when `tab.cwd` first arrives.

### Window styling

- macOS: `titleBarStyle: Overlay` + `hiddenTitle: true` in `tauri.conf.json` (native traffic lights via overlay).
- Linux: `decorations: false` + `transparent: true` from `tauri.linux.conf.json`; re-asserted post-realize for GNOME/Mutter CSD.
- Windows: same as Linux via `tauri.windows.conf.json`. React renders custom `WindowControls`.

### Tauri capabilities

`src-tauri/capabilities/default.json` is the allowlist for plugin APIs available to the webview. New plugins (dialog, autostart, updater, window-state, store, opener, os, log are wired in `lib.rs`) typically need:

1. `Cargo.toml` dependency
2. `.plugin(...)` call in `lib.rs` `run()`
3. capability entry in `default.json`

### Cross-platform conventions

- HOME / cache dirs: use the `dirs` crate (`dirs::home_dir()`, `dirs::cache_dir()`), never raw `$HOME` / `%USERPROFILE%`.
- Shell init scripts: gate Unix-only logic behind `#[cfg(unix)]`; Windows arm in `pty::shell_init::windows`.
- Terminal input: send `\r` (CR) for Enter, not `\n` (LF) - PowerShell on Windows requires CR.

### Bundle config

- `bundle.targets: "all"` plus per-platform sections in `tauri.conf.json`:
  - **macOS**: `minimumSystemVersion: 13.0`, entitlements at `src-tauri/entitlements.plist`.
  - **Linux**: deb depends `libwebkit2gtk-4.1-0`, `libgtk-3-0`; rpm `webkit2gtk4.1`, `gtk3`; AppImage bundles its media framework.
  - **Windows**: NSIS installer in `currentUser` mode (no admin required), WebView2 via `downloadBootstrapper`.
- Auto-updater configured with a public minisign key; release artifacts at `https://github.com/kevsmir02/terra/releases/latest/download/latest.json`.
- `bundle.resources` ships `resources/scrcpy-server-*.jar` for the device module.

### Known gotchas

- **React 19 strict mode** double-mounts `useEffect` in dev → terminals spawn twice on first render. The first PTY is cleaned up almost immediately. The `SPAWN_LOCK` mutex serializes this; don't be alarmed by `pty opened id=1` followed by `pty closed id=1` in dev logs.
- **Windows PowerShell process lifecycle**: `killer.kill()` from `portable-pty` only kills the immediate child. Descendants (e.g. `npm run dev` started inside pwsh) survive unless something else takes them down. The Job Object in `pty/job.rs` handles this for the Terra-process-death case; an explicit `pty_close` from JS also kills only the immediate child + relies on the Job to take the rest. Don't disable the Job without a replacement.
- **Tab `cwd` storage**: comes from OSC 7 with forward slashes (after `parseOsc7` strips `/C:` → `C:`). Anything that consumes `tab.cwd` and passes it to a Rust fs command on Windows must normalize separators or accept both forms - `apply_common` in `pty::shell_init` handles this for PTY spawn; other call sites must do their own.

## Further reading

- `THEME.md` - authoring a theme: the full token reference, surface classes, terminal palette contrast rules, and font metrics. Read it before writing a theme or adding a theme token.

Long-form contributor guides live under `docs/` (index: `docs/README.md`). These guides elaborate on `TERRA.md`; if anything conflicts, `TERRA.md` wins.
