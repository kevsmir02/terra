---
name: run-terra
description: Build, launch, drive and screenshot the Terra desktop app (Tauri 2 + React). Use when asked to run Terra, start the app, take a screenshot, verify a UI or theme change in the real app rather than in tests, or reproduce a visual bug.
---

# Running Terra

Terra is a Tauri 2 desktop app: Rust backend, React 19 + xterm.js frontend in a
WebKitGTK webview. It is **not** Electron, so there is no Playwright `_electron`
handle and no CDP endpoint. The only reliable way to observe it is to force the
window onto XWayland and grab the X root.

All of that is wrapped in `.claude/skills/run-terra/driver.mjs`. Use the driver.
Paths below are relative to the repo root.

## Prerequisites

Already present on a normal dev box for this repo. The two non-obvious ones:

```bash
magick -version   # ImageMagick 7. `magick x:root` is the only capture that works here.
node -v           # v22+, per package.json engines
```

There is no `xdotool`, `wmctrl`, `xwininfo` or `xvfb` on this machine, so there
is **no input automation**: the driver can screenshot, but it cannot click,
type, hover, or focus. See Gotchas.

## Build

The driver needs the debug binary. Build once (slow the first time):

```bash
cd src-tauri && cargo build && cd ..
```

## Run (agent path)

List the builtin theme ids, read from source so it cannot go stale:

```bash
node .claude/skills/run-terra/driver.mjs themes
```

Screenshot one theme. The driver starts Vite if it is not already up, seeds the
theme, launches the app, waits for first paint, captures, kills the app, and
restores your settings:

```bash
node .claude/skills/run-terra/driver.mjs shot --theme nothing --mode light --out /tmp/a.png
```

```
driver: starting vite (not reachable on :1420)
nothing          light   /tmp/a.png  (611 colours, ok)
```

Screenshot every builtin theme:

```bash
node .claude/skills/run-terra/driver.mjs shot-all --mode dark --outdir /tmp/terra-shots
```

`--mode` is `dark`, `light` or `system`. Each line reports the unique-colour
count; **anything under 50 means the window never painted** and the PNG is a
blank root, not a screenshot. Treat that as a failure, not a result.

**Look at the PNG.** A capture that "succeeded" can still show a half-loaded
frame. Read the file.

## Run (human path)

```bash
pnpm tauri dev
```

Opens a real window. Useless headless, and it will not give you a file to look
at. Use the driver instead unless you are sitting at the machine.

## Test

```bash
pnpm lint && pnpm check-types && pnpm test && pnpm build && pnpm knip && pnpm audit
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
```

## Gotchas

Each of these cost real time. None are guessable.

- **`import` cannot capture; `magick x:root` can.** ImageMagick 7's `import
  -window root` fails with `missing an image filename` on this Wayland session.
  `magick x:root out.png` works.

- **Without `GDK_BACKEND=x11` the window is invisible to capture.** Tauri
  defaults to the Wayland GDK backend and renders nothing into the X root, so
  every screenshot is a uniform 553-byte frame. Forcing `x11` routes it through
  XWayland, where the root grab sees it. The driver sets this.

- **Vite must be running or the window never appears at all.** `tauri.conf.json`
  sets `"visible": false` and the frontend calls `window.show()` only after it
  boots. A debug build loads `devUrl` (`http://localhost:1420`), so with no dev
  server the webview never loads, `show()` never fires, and the process sits
  alive with no window. This looks identical to a capture failure.

- **`pkill -f 'target/debug/terra'` kills your own shell.** The pattern matches
  the calling agent's command line, which contains that string. Symptom: your
  bash call dies with exit 143/144 and no output. Kill by PID. The same trap
  applies to `pgrep -f` for counting processes: if your command line mentions
  the word, you will count yourself. Check the port with `ss -ltnp | grep :1420`
  or compare `/proc/*/exe` instead.

- **Theme lives in the data dir, not the config dir.** It is
  `~/.local/share/app.kevsmir02.terra/terra-settings.json`, keys `themeId` and
  `theme` (`light` / `dark` / `system`). There is also a
  `~/.config/app.kevsmir02.terra/` directory; writing settings there does
  nothing. The driver reads and restores the real file.

- **Background processes die between agent tool calls.** A plain `pnpm dev &` in
  one call is gone by the next. The driver spawns detached and manages Vite's
  lifetime itself.

- **No input automation.** Focus rings, hover states and anything behind a click
  (for example the source-control panel, which needs the "Source" tab) cannot be
  reached by the driver. Verify those by hand, or install `xdotool` and extend
  the driver.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `(1 colours, BLANK - window never painted)` | Vite is not serving, or `GDK_BACKEND=x11` was dropped. Check `curl -sf http://localhost:1420`. |
| `import: missing an image filename` | You used `import`. Use `magick x:root`. |
| Bash call exits 143/144 with no output | A `pkill -f` / `pgrep -f` pattern matched your own shell. Kill by PID. |
| `no debug binary at .../target/debug/terra` | `cd src-tauri && cargo build` |
| App launches but shows the wrong theme | Something else wrote the settings file mid-run. Re-run; the driver restores settings in a `finally`. |
