<div align="center">
  <img src="public/logo.png" width="144" height="144" alt="Terra" />
  <h1>Terra</h1>

  <p><strong>Lightweight, terminal-first IDE for people who work through agent harnesses. Native PTY, editor, explorer, and source control, each on demand. No built-in AI.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/platform-Linux-lightgrey" alt="platform" />
    <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license" />
    <img src="https://img.shields.io/badge/fork%20of-terax--ai-orange" alt="fork of terax-ai" />
  </p>
</div>

---

Terra is a personal fork of [**Terax**](https://github.com/crynta/terax-ai) by [**crynta**](https://github.com/crynta). Full credit for the original project, its architecture, and the overwhelming majority of this codebase goes to them.

Upstream Terax is an *AI-native* terminal workspace. This fork strips the AI subsystem out and keeps the thing underneath: a strictly terminal-first IDE tuned for running Claude Code, Codex, Gemini CLI, Pi, OpenCode, Antigravity and the like. Around the terminal sit a code editor, file explorer, source control with a git graph, a web preview pane, opt-in language servers, and an Android device dock, each loaded only when opened and torn down when closed. No telemetry, no account, no model provider code.

## Status

This is my personal workspace tool, not a product.

- **One maintainer, no support.** I work on it when I need something. Updates may land monthly or not for a while.
- **Linux only.** Developed and used on Fedora; it should run on any current Linux with WebKitGTK. The macOS and Windows code paths inherited from upstream have been removed.
- **Public so you can fork it.** Apache-2.0, same as upstream. Take whatever is useful.
- **Issues are fine, promises are not.** If something is broken you are welcome to open an issue, but expect no timeline. For the AI features, signed releases, and a community, go to [Terax](https://github.com/crynta/terax-ai).

## Screenshots

<table>
  <tr>
    <td align="center"><img src="docs/device-preview.png" alt="Embedded Android device preview" /><br/><sub>Embedded Android device preview</sub></td>
    <td align="center"><img src="docs/themes.png" alt="Themes and background image" /><br/><sub>Custom themes, presets, and background images</sub></td>
  </tr>
</table>

## What changed from upstream Terax

### Removed: the entire AI subsystem

The fork point is `2b2973f0`. Everything below was deleted, not disabled or feature-flagged:

- The agentic side panel (chat, composer, mini-window, tool approvals, todo strip, context chips, slash commands), the built-in agents and subagents, the AI plan and diff review, editor AI autocomplete, "Ask AI" on selection, and voice input.
- All eight `@ai-sdk/*` providers, the `ai` SDK, the Models and Agents settings sections, and the OS-keyring secret store for provider keys.
- The AI-only backend plumbing: the outbound HTTP module (`net.rs`, `reqwest`, `tokio` and friends), the proxy fetch shim, and the background shell-session machinery that served AI tool calls. `shell_run_command` stayed, rewired, because format-on-save depends on it.
- Every remaining AI surface: command palette entries, status-bar indicator, shortcuts, settings fields, and props threaded through the header, input bar, and explorer.

Net effect: about 22k lines deleted across 167 files, 11 npm dependencies and 5 Cargo dependencies dropped. What remains is terminal, editor, git, files, preview.

> OSC 777 agent detection and status notifications are still here. That is *terminal* integration: it surfaces what a CLI agent running inside a PTY is doing. Terra runs no models itself.

### Added in this fork

- **Android device dock**: a running emulator or attached device mirrored into a resizable right-hand dock. Bundles `scrcpy-server.jar` (Apache-2.0), streams H.264 over ADB, decodes via Media Source Extensions, and sends multi-touch, scroll, and keys over the scrcpy control protocol with `adb shell input` as fallback. AVDs can be listed, booted, and stopped from the panel, and everything Terra started is torn down on exit.
- **Dev-server auto-detection**: the PTY watches shell output for loopback URLs and offers the detected server as a one-click preview chip, cleared on shell exit.
- **Project profiles and auto-launch**: spaces persist panel split ratios and run `startupCommands` when opened.
- **Live filesystem sync**: the explorer and open editor tabs follow fs-watch events. A dirty buffer is never clobbered; the pane says whether the file changed or vanished and offers an explicit reload or recreate.
- **Copy on selection**: opt-in, off by default, because a webview cannot reach the X11 primary selection so this replaces the clipboard.
- **Measured startup budget**: the eager startup set is computed from the built HTML and gated in CI alongside `knip`; the updater dialog and device surfaces moved out of the startup graph behind lazy wrappers.
- Renamed Terax to Terra throughout, simplified the release workflow, and a handful of fixes (markdown preview scrolling, a satisfiable minimum window size, preferences hydrating on every launch).

## Features

- **Terminal**: xterm.js with the WebGL renderer, native PTY via `portable-pty` (zsh, bash, fish), multi-tab with background streaming, split panes with layout restore, inline search, link detection, true color.
- **Editor**: CodeMirror 6 with the usual languages, on-save diagnostics by default, and an opt-in language server session that idles down and runs under a memory watchdog.
- **Source control**: stage, unstage, commit, push with upstream awareness, and a history pane with a real commit graph and per-file diffs.
- **Explorer**: Catppuccin icons, fuzzy search, keyboard navigation, inline rename, live sync with disk.
- **Preview**: local dev servers in a sandboxed tab, markdown with rendered and raw views, inline image, PDF, video, and audio viewers.
- **Themes**: bundled presets, an in-app theme builder, background images with opacity and blur, and an editor theme independent of the app theme.

## Build

Prerequisites: Rust stable, Node 20+, [pnpm](https://pnpm.io), and the [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/). On Fedora that is roughly:

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel
sudo dnf group install "c-development"
```

Then:

```bash
pnpm install
pnpm tauri dev      # development
pnpm tauri build    # .deb, .rpm, and AppImage under src-tauri/target/release/bundle
```

Checks, which is what CI runs. `TERRA.md` has the full definition of done.

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build && pnpm size:eager      # eager startup budget per window
pnpm knip
pnpm audit --prod && pnpm audit
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo nextest run --locked                           # or: cargo test --locked
cd src-tauri && cargo audit
```

Pushing a tag runs `release.yml`, which builds and signs the Linux bundles.

### Linux notes

- **AppImage** needs FUSE. Without it: `./Terra_*.AppImage --appimage-extract-and-run`. On Wayland with rendering glitches try `WEBKIT_DISABLE_DMABUF_RENDERER=1`. The `.rpm` and `.deb` link against the system GTK stack and tend to be smoother.
- **Device dock** needs `adb` on your `PATH` or a discoverable Android SDK. `scrcpy-server.jar` ships bundled, so no separate scrcpy install is required.

## Docs

- [`TERRA.md`](TERRA.md): architecture, invariants, budgets, and the definition of done. Loaded as agent memory.
- [`ROADMAP.md`](ROADMAP.md): what is next and what stays out.
- [`THEME.md`](THEME.md): authoring a theme.
- [`docs/`](docs/): two long-form guides (terminal renderer pool, device mirroring) and the decision records.

## Tech stack

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Tailwind v4, shadcn/ui, Zustand.

## Credits

- [**crynta**](https://github.com/crynta): creator of [Terax](https://github.com/crynta/terax-ai), the project this is forked from. Nearly all of the terminal, editor, git, explorer, preview, and theming work is theirs.
- [scrcpy](https://github.com/Genymobile/scrcpy): `scrcpy-server.jar` is bundled for the device dock (Apache-2.0).

## License

Apache-2.0, inherited from upstream Terax. See [LICENSE](LICENSE).
