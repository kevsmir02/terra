# TERRA.md

Terra loads `TERRA.md` from the workspace root as agent memory (similar to AGENTS.md / CLAUDE.md). It is also the project's living architecture doc: read it before making changes, and update it in the same change whenever an invariant, gate, or module boundary moves. Long-form guides under `docs/` elaborate on it; if anything conflicts, `TERRA.md` wins.

## Product

**Terra** is a lightweight, terminal-first IDE for developers who spend their day in agent harnesses (Claude Code, Codex, OpenCode and the like) rather than typing code by hand. Tauri 2 + Rust (`portable-pty`) backend, React 19 + TypeScript + xterm.js (webgl) client.

The terminal is the product. Everything else (editor, explorer, source control, preview, device mirror, language servers) exists so the user can read, verify, and touch up what an agent produced without leaving the window. Each of those surfaces is **on demand**: dormant until opened or enabled, dormant again when closed.

Lightweight is measured, not asserted. The eager startup graph, the total client bundle, and idle work all have gates (see **Budgets**), and Terra stays small by keeping features dormant rather than by refusing them. Heavy IDE machinery (debuggers, refactoring engines, project-wide indexers, package-manager UIs, document hosts) is out of scope; `ROADMAP.md` is the authority on direction and lists what is deliberately out.

Terra is a personal fork of Terax, maintained by one person for their own use: no other contributors, no support commitment, and docs that describe the system rather than a process for outsiders. It is developed, tested, and released on Linux only (Fedora day to day). The macOS, Windows, and WSL code paths inherited from upstream are gone (`docs/adr/0002-linux-only.md`); nothing in the tree targets another platform. Security by default (every disk and process access gated by the workspace registry) holds for every feature.

## On demand

A feature has two states, and both are designed:

- **Dormant** (closed, disabled, or never used): no process, no thread, no timer, no PATH probe, no listener doing work, no store subscription, and nothing in the eager bundle beyond the shell that offers to turn it on. Disabled and unset cost the same as absent.
- **Live** (the user opened or enabled it): owns exactly the resources it needs, bounded (caps, idle shutdown, memory watchdog), and returns to dormant on close, on disable, and on `RunEvent::Exit`.

Patterns already in the tree, to copy rather than reinvent:

- Frontend surfaces load through `*Lazy.tsx` wrappers (`EditorStackLazy`, `GitDiffStackLazy`, `GitHistoryStackLazy`, `MarkdownStackLazy`, `CommandPaletteLazy`, `DeviceDockLazy`, `SourceControlPanelLazy`, the Settings sections). `src/app/eager-budget.test.ts` locks the heavy stacks out of both windows' eager graphs and `pnpm size:eager` measures the real startup set from the built HTML.
- Rust commands spawn nothing until called. Long-lived things (PTYs, LSP servers, device sessions, watchers) live in a `*State` and die on close and on exit.
- Polling exists only while something is live and someone is looking: the LSP memory watchdog only while a server runs, the AVD boot poll only while a launch is in flight.
- Opt-in persists in the settings store (`lspActivation`: `enabled` / `dismissed` / unset), and the UI offers a feature only where its tool exists.

A new feature is done when its dormant state costs nothing on the list above, the eager budgets are unchanged, it tears down on close, disable, and exit, and a test locks the invariant (the module stays out of the eager graph, or its state is empty when disabled).

## Budgets

| Budget | Set in | Gate |
| --- | --- | --- |
| Eager startup JS per window (entry script plus every `modulepreload`, gzipped) | `eager-budget.json` | `pnpm build && pnpm size:eager` (CI) |
| Heavy stacks out of the eager graph (`@codemirror`, `streamdown`, ...) | `src/app/eager-budget.test.ts` | `pnpm test` (CI) |
| Total client JS, gzipped | `.size-limit.json` | `pnpm size` (local) |
| Language server RSS and session count | `lsp/session.rs` (`DEFAULT_MAX_RSS_MB`), `lsp/lib/sessionManager.ts` (4 per server) | watchdog kills a server over budget; the manager refuses a fifth |
| Idle work | **On demand** above | review: a new timer, thread, or process needs a live surface to justify it |

Raising a budget is its own reviewed decision, recorded in the commit message with the reason. For every change ask: how much RAM it costs, whether it adds IPC round-trips or redundant requests, whether it triggers extra re-renders or wasted work, whether it pulls a heavy dependency.

## Deliverables

Production-grade or it does not ship. A change is done when all of these hold:

- **Checks green.** CI (`.github/workflows/ci.yml`) is the authority; run its steps locally before claiming done.
  - Frontend: `pnpm lint`, `pnpm format:check`, `pnpm check-types`, `pnpm test`, `pnpm build && pnpm size:eager`, `pnpm knip`, `pnpm audit --prod` and `pnpm audit`.
  - Rust: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`, `cargo nextest run --locked` (local fallback: `cargo test --locked`), `cargo audit`, then `git diff --exit-code src/modules/device/generated` (the `ts-rs` export must be committed).
  - `pnpm lint` runs with `--error-on-warnings`: a deliberate exception carries `// biome-ignore <rule>: <reason>`. Accepted Rust advisories live in `src-tauri/.cargo/audit.toml` with their rationale; anything unlisted fails.
- **Invariant locked.** A change to a core subsystem (terminal/shell spawn, workspace authorization, git, fs, IPC, the dormant state of a feature, and pure logic with wide reach such as cwd inheritance, tab-tree transforms, and OSC parsing) ships with a test that fails when the invariant breaks. Test the deny path and the edge, not the happy path; `fs::authorization_tests`, `workspace::auth_tests`, and `src/app/eager-budget.test.ts` are the models. UI rendering, themes, and anything the type-checker already guarantees need no test.
- **Correct under stress.** Edge cases, failure modes, and concurrent access handled. Every boundary (IPC, fs, network, OSC) validates its input.
- **Within budget.** See **Budgets**. A dormant feature costs nothing.
- **Linux only.** No `#[cfg(windows)]` or `#[cfg(target_os = "macos")]` arm, no platform crate, no matrix job. A change that would need one is out of scope (`docs/adr/0002-linux-only.md`).
- **Polished.** Every UI state considered (loading, empty, error, disconnected, disabled), keyboard-first, themed through the central engine.
- **Architected.** New or changed logic lives in pure, dependency-light functions (functional core); Tauri commands and React components stay thin (imperative shell).
- **Documented.** `TERRA.md` updated when an invariant, gate, or module boundary changed. A decision that would otherwise be re-litigated gets an ADR in `docs/adr/` (numbered, append-only; a superseded record is marked, never deleted).

## Conventions

- **Comments**: default to none, the code should explain itself. If genuinely needed, 1-2 lines on *why*, never *what*.
- **No em-dash** anywhere: code, comments, commits, docs.
- **No emojis** anywhere.
- **Commits**: `type(scope): summary` in the imperative, matching the log. **No AI attribution**: never `Co-Authored-By:` for Claude or any assistant, never a "Generated with Claude Code" line. Earlier commits carry these; do not copy them when matching commit style. The `commit-msg` hook in `scripts/git-hooks` (wired by the `prepare` script through `core.hooksPath`) strips them as a backstop.
- **Imports**: always `@/...` on the frontend, never relative across modules.
- **pnpm only**, never npm/npx/yarn.
- **Issues**: GitHub Issues on `kevsmir02/terra` via the `gh` CLI. Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.

## Architecture

### Two-process model

**Rust (`src-tauri/`)** owns all OS access. The webview never touches the FS, processes, or shells directly: everything goes through `invoke()` calls to commands registered in `src-tauri/src/lib.rs`. The `generate_handler![...]` block there is the command catalog; there is no separate list to keep in sync. Adding a command: write it as a thin `#[tauri::command]` over a core function taking `&WorkspaceRegistry` or plain data (so it is unit-tested without a Tauri runtime), register it in `lib.rs`, add a typed wrapper under `src/modules/<area>/lib/`, pick the right authorization gate or argument validation at the boundary, and if it starts anything long-lived keep it in a `*State` that dies on close and on `RunEvent::Exit`. The module map:

- `pty::*`: long-lived interactive PTY sessions (xterm to portable-pty), managed by `PtyState` (`RwLock<HashMap<id, Session>>`); output streams via a Tauri `Channel<PtyEvent>`. Each session runs three threads: a reader, a flusher that coalesces output for the channel, and a waiter that flushes the tail and reports the exit code. The pending buffer is capped at 4 MiB and on overflow is replaced by an SGR reset plus a notice, so a sliced CSI never corrupts xterm state. The reader hosts three byte filters: `da_filter.rs` answers PowerShell's startup cursor-position query so the shell does not hang, while agent detection (`agent_detect.rs`) and dev-server URL detection (`url_detect.rs`) are zero cost when nothing matches.
- `blocking::*`: `on_registry` / `on_app`, the hop to the blocking pool. The command macro expands a non-`async` `#[tauri::command]` body inline, and on this platform the IPC message arrives on the WebKitGTK signal handler, which runs on the GTK main loop: a sync command that walks a tree, greps a repo or copies a directory freezes painting and input, not just IPC. Every command that touches the disk or spawns a process goes through here, and `blocking::tests` fails on any new sync command not listed in `SYNC_BY_DESIGN` with a reason.
- `fs::*`: explorer and editor IO (`tree`, `file`, `mutate`, `watch`), fuzzy finder and content search (`search`, `grep`, powered by `ignore` + `grep-*`). Every command here is async over a pure core taking `&WorkspaceRegistry`, so the gate stays unit-testable and the work stays off the UI thread.
- `git::commands::*`: the full source-control surface, all gated through the workspace registry, including commit amend, stash push/pop/list, and branch creation; `is_safe_branch_name` (tested) vets a name before `git switch -c` so it can never read as an argument.
- `workspace::*`: the authorization registry (`workspace_authorize` / `workspace_current_dir`).
- `lsp::*`: language server process host. A dumb JSON-RPC pipe: Content-Length framing + process lifecycle in Rust (`lsp/framing.rs`, pure + tested), protocol intelligence on the frontend. Spawn cwd gated through the registry; binaries resolve via the captured login-shell env (`env.rs`, a desktop launch inherits a bare PATH); root detection walks up to markers but never to or above `$HOME`. Servers run in their own process group and are group-killed (cargo check / proc-macro children die with the server). A per-server memory watchdog kills a server over its RSS budget after a startup grace. All sessions killed on `RunEvent::Exit`.
- `device::*`: Android device and emulator mirroring, plus the SDK install offer (see **Device module**).
- `agent::*`: installs the agent notification hooks (see **agents/** below). `updater::*`: package-aware update flow around `tauri-plugin-updater`; `updater_download` is the only outbound HTTP client in the app (HTTPS only, hosts allowlisted to the GitHub release hosts, every redirect hop checked, body capped at 512 MB, connect and global timeouts bounded, each rule a free function with tests). There is no general-purpose fetch; a new network-facing command copies that shape. `open_settings_window` (optional `tab` arg deep-links a section), `open_preview_tab`, `get_launch_dir` / `get_launch_files` (drained-once CLI launch target).

### Workspace authorization

`WorkspaceRegistry` (`modules/workspace.rs`) is the single answer to "may the webview touch this path". Everything that reaches the disk or spawns a process goes through it: **fs, git, PTY/shell spawn, LSP spawn, and the asset protocol**.

`authorize` keeps the root set minimal: a path already covered by a root is a no-op, and a path that covers existing roots replaces them. Coverage is identical either way, which is what makes the collapse safe; without it an OSC 7 `cd` per directory would grow a set that every gate scans linearly.

Roots are added only by a user gesture: app launch (cwd + every CLI file argument), `$HOME` at bootstrap, a terminal `cd` (OSC 7 re-authorizes), a space root typed in Settings, and a real OS drag-drop (registered from the `DragDrop` window event in `lib.rs`, *not* from the paths JS hands back). Registering the dropped path itself rather than its parent keeps the grant as narrow as the gesture.

Four gates in `fs/mod.rs`, and picking the wrong one is a real bug:

| Gate | Use for | Behaviour |
| --- | --- | --- |
| `authorized_read` | reads, directory walks | canonicalizes via the registry's TTL cache |
| `authorized_write` | writes to an existing path | canonicalizes fresh (a stale cache entry is the symlink-swap window) |
| `authorized_entry` | delete, rename source, `fs_stat` | authorizes the **parent**; never resolves the final component, so a symlink is acted on as itself |
| `authorized_new` | create, rename/copy target | authorizes the nearest existing ancestor, re-joins the missing tail |

Canonicalizing first is what makes the check mean anything: `..` collapses and symlinks resolve, so the root is compared against the real target rather than the spelling. `is_authorized` uses `Path::starts_with`, which is component-wise; a string prefix would let `/home/user2` pass for `/home/user`.

Commands stay thin shells over a core taking `&WorkspaceRegistry`, so the gate is unit-testable without a Tauri runtime (`fs::mutate::create_file`, `fs::grep::grep`, ...). The invariants are locked in `fs::authorization_tests` and `workspace::auth_tests`, and a change to the registry or a gate covers all of them: a path outside every root is refused by its spelling and again after canonicalization, `..` cannot climb out, the entry gate leaves a symlink unresolved, the new-path gate allows a missing tail inside a root and refuses one outside, and authorizing a single file never authorizes its siblings.

The asset protocol (`asset://`, used for image/video/audio/PDF previews) has an **empty static scope**. `fs_allow_asset` grants one already-authorized file at a time via `asset_protocol_scope().allow_file()`. A blanket `"**"` scope would hand the webview arbitrary file reads over a channel this registry never sees.

### PTY shell integration

PTY shells are bootstrapped via injected init scripts in `src-tauri/src/modules/pty/scripts/`:

- Scripts (`zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh`, `bashrc.bash`) for zsh/bash, plus `init.fish` installed to `~/.config/fish/conf.d/terra.fish` for fish. Emit OSC 7 (cwd) and OSC 133 A/B/C/D (prompt boundaries + exit code) so the host can track cwd and detect command boundaries without re-parsing the prompt. Fish 4.0+ writes its own OSC 133 prompt markers; Terra sets `fish_features=no-mark-prompt` and re-asserts its own prompt via `-C` to avoid doubling.
### Device module (`src-tauri/src/modules/device/`)

Android device and emulator mirroring over the platform-tools on PATH, on demand: nothing runs until the dock opens, and `device_close` and `RunEvent::Exit` kill every session and every Terra-launched AVD (AVDs the user started elsewhere are left alone). Vocabulary (device, serial, readiness, AVD, emulator, session, mirror, dock) and the stream pipeline (scrcpy server, `StreamAssembler` remux, `FrameTimeline` pacing, control protocol, frontend playback policy) are in `docs/architecture/device-mirroring.md`.

Invariants to keep:

- `DeviceEntry` is exported by `ts-rs` during `cargo test` into `src/modules/device/generated/`; the frontend consumes it and never restates it. Readiness is `DeviceEntry::is_ready`, never a comparison against the literal `"device"`.
- With no system image on disk the dock offers to install one, and with no SDK at all it offers to install that too. Terra never downloads either: `device_sdk_install_command` resolves one shell line and `runInTerminal` runs it in a terminal tab, so the multi-gigabyte download and Google's licence prompts happen in front of the user and `PtyState` owns the teardown (`docs/adr/0004-sdk-install-runs-in-a-terminal-tab.md`, `docs/adr/0005-terra-bootstraps-the-standalone-android-sdk.md`). It branches on whether `sdkmanager` resolves: present, the line installs from a hardcoded catalog (last three API levels, `google_apis`, host ABI); absent, `build_sdk_bootstrap_command` prefixes a `curl` of the pinned cmdline-tools zip, a `sha256sum -c` against a pinned digest, an `unzip` and a `mv`, then ends in that same `sdkmanager` call. These are shell *lines*, not argv, so every package is checked against the catalog and every element quoted; the tests parse each stage back through `sh` and compare the argv. Three properties of the bootstrap line are locked by test and must stay true: no `$` or backtick (the tab's shell may be fish, which has no `x=$(...)`, so staging is a fixed `<root>/.terra-bootstrap` rather than `mktemp -d`), `&&` throughout (a failed digest never reaches the unzip), and no recursive delete (`rm -f` on the one staged file plus `rmdir`). `CMDLINE_TOOLS_SHA256` is derived from the artifact after checking Google's published sha1, and re-derived on a bump. Prerequisites (`curl`, `unzip`, `sha256sum`, `java`) are probed first: a missing one yields `SdkSetup::Blocked` with the tool named and no button, and Terra never composes a `sudo` line. Completion is the image appearing on disk for both branches: `useSdkSetup` polls `device_list_system_images` only while an install is in flight, and creates the AVD when it lands. `AdbMissing` renders the offer rather than prose, since with no SDK `adb` never resolves and that state would otherwise be the one dead end left.
- Every process is spawned argv-style. AVD names pass `is_safe_avd_name`, serials pass `ensure_safe_serial` (`emulator-5554` and `host:port` shapes only, no leading `-`); adding a command that takes a serial means calling it. Coordinates are `u32`, so they cannot carry an argument. The one string Terra hands to a shell is the install line above, which is why it carries its own allowlist, quoting and round-trip test.
- `device_open` and `device_close` run in `spawn_blocking`, so a session never stalls the IPC thread.
- Each session has its own `scid` and abstract socket, both forwarded ports are claimed explicitly, and a failed start removes both.
- The mirror never reconnects on its own (`docs/adr/0001-mirror-does-not-reconnect-automatically.md`): `on_exit` fires only for stops the webview did not request, and the pane dims the last frame and offers Reconnect.

### Concurrency

`modules/sync.rs` provides `lock_or_recover` / `read_or_recover` / `write_or_recover`. Use them for all long-lived shared state (`PtyState`, `WorkspaceRegistry`, `DeviceState`, `LspState`, ...) instead of `.lock().unwrap()`. A panic while a lock is held poisons it for the rest of the process, which would turn one bad frame into a permanently dead subsystem; every value behind these locks is plain data, so recovering the guard is strictly better than propagating the panic to every later caller.

### Frontend (`src/`)

Single-window React app. Path alias `@/*` maps to `src/*`. Tabs are a tagged union (`kind`: `terminal` | `editor` | `preview` | `markdown` | `git-diff` | `git-history` | `git-commit-file`) and **not** unmounted on switch: they're hidden via `invisible pointer-events-none` so PTYs and dev servers keep streaming in the background.

`App.tsx` wires modules together; keep it a coordinator. New features go inside the appropriate `modules/<area>/`.

### Module layout (`src/modules/`)

Each module is self-contained, exports a thin barrel via `index.ts`, and owns its hooks under `lib/`.

- **terminal/**: `TerminalStack` keeps one mounted xterm per tab via `useTerminalSession` + `pty-bridge`. `osc-handlers.ts` parses OSC 7 and OSC 133 markers. The xterm palette is driven by the central theme engine (`modules/theme`), not a local table. Renderer slots are pooled (`rendererPool.ts`, max 5): a hidden leaf with a foreground job (OSC 133 C..D, agent signal, or `pty_has_foreground_job`) keeps its live grid parked with rendering paused via `display:none`; an idle hidden leaf releases its slot but the buffer is retained and serialized lazily only when another leaf steals it. The `DormantRing` (1 MiB, no terminal reset on overflow) buffers bytes only for leaves whose slot was stolen or never bound. Never serialize a leaf that is mid-command: replaying incremental TUI repaints over a snapshot is what used to wipe Claude Code. A split draws which leaf takes the next keystroke: `PaneFocusRing` rings the focused leaf and dims the unfocused one's edge only, never its output, so the other agent stays readable, and `PaneAttentionEdge` marks a leaf whose agent is waiting. Both are overlays, so neither changes pane geometry. `pathLinks.ts` registers an xterm link provider per slot: path-shaped tokens on the hovered line (`findPathLinks`, pure and tested) resolve against the leaf's OSC 7 cwd, are confirmed with `fs_stat` through a short-lived cache, and open the editor at the line; nothing runs until a line is hovered. Every OSC 133 prompt keeps a marker (`registerPromptTracker`, capped at 500) so `terminal.prevCommand` and `terminal.nextCommand` scroll between commands and `terminal.selectLastOutput` and `terminal.copyLastOutput` act on the last C..D span; `commandMarks.ts` holds the pure line arithmetic. Scrollback survives a relaunch: on a decided app close, `useSpacePersistence.flushWithScrollback` serializes every terminal leaf (`persistedScrollback`: the live or parked slot's last 1000 lines capped at 128 KB by `capScrollback`, a stolen slot's retained snapshot, or a never-opened leaf's restored text; an alternate-screen leaf persists nothing) into the space state and forces the store to disk; boot stashes each leaf's text (`stashRestoredScrollback`) and the session replays it before the shell spawns. Regular flushes never write scrollback, so idle persistence stays small.
- **editor/**: CodeMirror 6 stack (`EditorStack` mirrors `TerminalStack`). `extensions.ts` configures language modes. Buffers live in LF space and the original EOL (`lib/eol.ts`, majority-vote detection) is restored on save; indent unit/tab size are detected per file (`lib/indent.ts`) via a per-pane compartment. Saves are conflict-checked against the disk mtime returned by `fs_read_file`/`fs_write_file` (mismatch means a warning toast with explicit Overwrite, never silent last-writer-wins). Files over 10 MB offer "Open anyway" (hard cap 50 MB, `force` arg); above 4 MB syntax highlighting and LSP stay off. Cmd-F routes to CodeMirror's own search panel when an editor tab is active, Ctrl-G opens go-to-line; both styled in `chromeTheme.ts`. Format on save is opt-in and goes through the active language server only. `lib/diagnosticsStore.ts` counts CodeMirror lint diagnostics per file for the statusbar with no server involved. Diff panes resolve the language before mounting CodeMirror: a late compartment reconfigure leaves the merge view's deleted-chunk widgets unhighlighted. Editor code size is stored separately as `editorFontSize` and does not affect `terminalFontSize`.
- **explorer/**: file tree with a theme-selected icon set (`lib/iconProvider.tsx`: Catppuccin SVGs loaded on first use, or Nerd Font glyphs), fuzzy search, keyboard nav, inline rename, context actions, live re-read on fs-watch events. Backslash-aware `basename`.
- **preview/**: dev-server preview tab. Detection is Rust-side on the PTY byte stream (`pty/url_detect.rs`); the frontend keeps the detected URL per leaf in `devServerStore.ts` and renders a one-click `DevServerChip` on the terminal pane, cleared on shell exit.
- **tabs/**: `useTabs` is the source of truth for tab list + active id. A tab icon says what **kind** of tab it is and nothing else; a tab's agent state is `TabStateBar`, a 2px bar under the pill coloured from the status roles (renamed working, warning attention, ok finished), because an icon can only carry one meaning at a time. `useWorkspaceCwd` derives explorer root + inherited cwd for new tabs from the active tab. `basename` splits on both `/` and `\`.
- **header/**: top bar, 36px: space switcher, tab strip, search, `WindowControls` (custom minimize, maximize, close). Nothing else lives here; the sidebar toggle, command palette and settings entries sit on the rail and the agent cluster sits in the statusbar, so the tab strip gets the width. `SearchInline` adapts to terminal vs editor vs commit history via `SearchTarget` and renders as a panel anchored under its button rather than a permanent field: it opens on `search.focus` or the button and closes on Escape, which is what the narrow-window path already did.
- **statusbar/**: bottom bar, 30px, two zones. Left says where you are: `CwdBreadcrumb` (path segments and home `~` via `pathUtils.segmentsFromCwd`) and `GitStatusChip`, a read-only mirror of the branch, ahead/behind and dirty count the source-control summary already resolved (the panel owns every action). Right says what state things are in: the private-mode chip, the agent cluster, the LSP pill, the diagnostics badge. The cluster arrives as a `ReactNode` prop so the statusbar keeps no dependency on agents, the way the header takes `spaceSwitcher`.
- **shortcuts/**: keymap registry (`shortcuts.ts`) + `useGlobalShortcuts`. Handlers live in `App.tsx` and are passed in by id (`tab.new`, ...). Recording a chord previews the actions that already claim it.
- **settings/**: settings store (`store.ts` via `tauri-plugin-store`), preferences hook, settings window opener. Settings is its own webview window with its own eager budget; sections beyond the first load lazily.
- **sidebar/**: the rail plus the collapsible side panel (explorer, source control, devices). `SidebarRail` is a 54px vertical rail at the frame edge, a sibling of the panel group rather than a child of the panel, so view switching survives a collapse: it is wired to `cycleSidebarView`, where clicking the active view collapses the panel, clicking another switches it, and clicking anything while collapsed reopens on that view. Its foot carries the command palette and settings entries under a hairline. The panel's `defaultSize` is frozen at mount (`useSidebarPanel.initialSidebarSize`): `react-resizable-panels` re-registers a panel whose `defaultSize` changes identity, and since App re-renders on every resize tick, deriving it from the live width ref killed the drag on its first pixel (`useSidebarPanel.test.ts`). Reopening replays `terra-panel-in` on the panel body, which stays mounted across a collapse and so cannot animate on remount the way a view switch does.
- **source-control/**: git status / stage / commit panel and diff workflow, with an Amend toggle on the commit box, a Stash dropdown (push, pop, list) beside the branch picker, and a new-branch input at the top of that picker.
- **git-history/**: commit graph rail, refs, per-commit file diffs.
- **lsp/**: opt-in language server support, zero cost until enabled (no process, no PATH check, nothing in the eager bundle beyond a 14.5 kB shell). Statusbar pill offers Enable (binary found) or Install (with copyable command) per language; activation persists as `lspActivation` (`enabled`/`dismissed`/unset). `sessionManager.ts` keys sessions by (server, workspace root), refcounts open docs, idle-kills after 3 min, and crash-backoffs (cooldown before respawn; 3 in 5 min means give up + toast with the server's stderr tail). Resource invariants: **no root marker, no session** (a dirname fallback once spawned a server per directory and burned GBs), hard cap of 4 sessions per server, lean per-preset `initializationOptions` (rust-analyzer: `cachePriming` off + bounded `lru`; tsls: `maxTsServerMemory`). Client is `codemirror-languageserver` behind a lazy import, subclassed (`lib/client.ts`) to add didClose/didSave/shutdown, `textDocument/references` (Shift-F12; multi-result definitions and references share the `locationsPanel.ts` picker) and the publishDiagnostics capability the lib forgets (tsls sends no diagnostics without it); `lib/transport.ts` bridges to the Rust pipe and answers server-to-client requests the lib ignores. `vscode-languageserver-protocol` is aliased to a 4-enum shim in vite.config.ts (~117 kB saved). Several presets can claim one language (pyright and ruff both take `py`): `serverForLanguage` prefers the enabled candidate.
- **markdown/**: markdown preview renderer (backs the `markdown` tab kind), lazy.
- **theme/**: custom theme engine (no `next-themes`). `ThemeProvider` + `applyTheme` write CSS variables; the TypeScript builtins in `themes/` are the only themes. Syntax and status colours derive from each theme's ANSI palette (`resolveTheme.ts` + `oklab.ts`, both pure). The theme owns the scales the chrome resolves through (radius and pill radius, shadow tint, blur factor, border width and style) via the `@theme inline` bridge in `globals.css`, the `terra-label` utility for chrome casing and tracking, motion (`motion.speed` scales every duration, `motion.easing` is the shared curve) through the `terra-motion` utility, the explorer icon set (`icons`: Catppuccin SVGs loaded lazily, or Nerd Font glyphs), and whether the user's wallpaper shows (`effects.wallpaper`, read by `SurfaceLayer` through `wallpaperAllowed`). `layers.ts` fixes the root paint order: the wallpaper wash clears app chrome, the preview iframe clears the wash so it stays pixel-accurate, and both stay under the `z-50` the shadcn primitives portal into `document.body` with, since a surface above the overlay layer swallows every menu and dialog opened over it (`WorkspaceSurface.test.ts`). Components never use `rounded-full`, `uppercase`, arbitrary shape values, or palette colours: `src/app/theme-contract.test.ts` fails on any of them outside its reasoned allowlist (`docs/adr/0003`). The whole app renders in the bundled JetBrainsMono Nerd Font; themes do not pick a face. The terminal font is a Settings choice (`terminalFont`: one of three bundled Nerd Font Mono families, or `system` with a typed family), resolved by `src/lib/fonts.ts`; `src/styles/fonts.test.ts` locks every family the app names to a shipped woff2 face. The faces live in `src/assets/fonts` (16 MB of woff2, outside the JS budgets) and a face is parsed only when text renders in it. **Authoring a theme or adding a theme token: read `THEME.md` first.**
- **updater/**: auto-updater UI built on `tauri-plugin-updater`, dialog out of the startup graph.
- **agents/**: notifications for the terminal harnesses that are the reason Terra exists. Shared store (`store/agentStore.ts`: terminal `sessions` + `notifications`) and a shared router (`lib/route.ts`: suppress when focused-and-visible, OS-notify when unfocused, in-app Sonner toast when focused-but-hidden) feed the statusbar `AgentStatusCluster` (one chip per state, never one per agent, so the zone cannot grow unbounded; a single waiting agent is named, more than one collapses to a count). Its management surface is `AgentPanel`, lazy behind the popover: the hook installer, the notification list and their icons are worth nothing until it opens. Toasts use Sonner (`components/ui/sonner.tsx`) themed via the central engine; `lib/agentIcon.tsx` renders the per-agent brand mark.
  Detection is Rust-side (`pty/agent_detect.rs`) on the PTY reader's byte filter, armed on `OSC 133;C;<cmd>` or self-armed by the marker, emitting `terra:agent-signal` transitions (`started`/`working`/`attention`/`finished`/`exited`) driven only by OSC sequences (never raw output, so a repainting TUI never flaps); zero cost when no agent runs. A BEL from any program (xterm `onBell`, dispatched as `terra:terminal-bell`) routes through the same router as an attention event for the pane's tab, throttled per leaf by `lib/bellGate.ts` and skipped when a hooked agent reported attention inside the same window, so OpenCode and any bell-ringing CLI notify without an installer.
  All harnesses converge on the same `OSC 777` marker the detector reads, installed via `agent_enable_hooks(agent)` / `agent_hooks_status(agent)` in `modules/agent.rs` (data-driven `AgentSpec`; atomic writes, foreign configuration preserved, idempotent; gated on `TERRA_TERMINAL`). Delivery differs because only Claude's hook protocol can return terminal bytes in the hook *response*. **Claude** (`~/.claude/settings.json`, `UserPromptSubmit`/`Notification`/`Stop`) returns the marker via the `terminalSequence` field (legacy 3-field `notify;Terra;<event>`). **Codex** (`~/.codex/hooks.json`, `UserPromptSubmit`/`PermissionRequest`/`Stop`) can't, so the hook *command* emits the 4-field `notify;Terra;<agent>;<event>` marker itself (`printf > /dev/tty`) and prints `{}` as a JSON stdout no-op (Codex's `Stop` rejects empty/non-JSON stdout). The agent-named marker lets a self-arm name the right agent when no preexec fired (bash/tmux). **OpenCode** is known to the detector (started/exited from the `OSC 133;C` command name) but has no hook installer yet, so it produces no working/attention/finished transitions. Supporting a new harness means one `AgentSpec` that lands the same marker; the detector and router stay untouched.
- **command-palette/**: modal command palette (`CommandPalette.tsx`, `commands.ts`) for actions and navigation, lazy.
- **spaces/**: workspace spaces/projects (name, root, env, color, per-space tab persistence, panel split ratios, `startupCommands` run when a space opens) via `useSpaces` and `SpaceSwitcher`.

### UI conventions

- **shadcn/ui** is configured (`components.json`, style `radix-luma`, base `mist`, icon lib **hugeicons**). Primitives in `src/components/ui/`; don't hand-edit, re-run `pnpm dlx shadcn add` to upgrade.
- Animation is CSS only, no library. `tw-animate-css` drives the Radix overlays; the bespoke entrances (`terra-panel-in`, `terra-tab-in`, `terra-pill-in`, `terra-row-in`, `terra-fade-in`, `terra-pop-in`) live in `globals.css`. Durations come from `--dur-fast` / `--dur-base` / `--dur-slow` and the curve from `--ease-out`, all scaled by the theme; chrome wears `terra-motion` rather than a `duration-*`/`ease-*` pair. A keyframe animates `transform` and `opacity` and nothing else, every class has a consumer, and reduced motion collapses `--motion-reduce` (not `--motion-scale`, which applyTheme writes inline and would outrank the media query): `src/styles/motion.test.ts` locks all three. Never `transition-all`: it transitions layout properties too. Resizable layout: `react-resizable-panels`.
- Canonical path form on the frontend is **forward-slash**. OSC 7 already arrives as forward-slash. Equal canonical strings keep `useFileTree` from wiping its tree and flashing the explorer when `tab.cwd` first arrives.

### Window styling

`decorations: false` + `transparent: true` in `tauri.conf.json`, re-asserted post-realize for GNOME/Mutter CSD. React renders the custom `WindowControls`.

### Tauri capabilities

`src-tauri/capabilities/default.json` is the allowlist for plugin APIs available to the webview. A new plugin needs the `Cargo.toml` dependency, a `.plugin(...)` call in `lib.rs` `run()`, and a capability entry in `default.json`. Custom commands are covered by the window capability; plugin permissions are not.

### Process conventions

- HOME / cache dirs: use the `dirs` crate (`dirs::home_dir()`, `dirs::cache_dir()`), never raw `$HOME`.
- Terminal input: send `\r` (CR) for Enter, not `\n` (LF).

### Bundle config

`tauri.conf.json` is the source of truth for the bundle: the targets are deb, rpm, and AppImage; the auto-updater is signed with a public minisign key and reads `https://github.com/kevsmir02/terra/releases/latest/download/latest.json`; `bundle.resources` ships `resources/scrcpy-server-*.jar` for the device module.

### Known gotchas

- **React 19 strict mode** double-mounts `useEffect` in dev, so terminals spawn twice on first render. The first PTY is cleaned up almost immediately; `pty opened id=1` followed by `pty closed id=1` in dev logs is expected.

## Further reading

- `ROADMAP.md`: what is next and what is deliberately out of scope.
- `THEME.md`: authoring a theme, the full token reference, surface classes, terminal palette contrast rules, font metrics. Read it before writing a theme or adding a theme token.
- `docs/architecture/terminal-renderer-pool.md` and `docs/architecture/device-mirroring.md`: the two long-form guides; `docs/adr/` holds the decision records. These elaborate on `TERRA.md`; if anything conflicts, `TERRA.md` wins.
