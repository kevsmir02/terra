#!/usr/bin/env node
// Terra run-driver: launch the real app headlessly-ish and screenshot it.
//
// Terra is Tauri (WebKitGTK), not Electron, so there is no Playwright
// `_electron` handle and no CDP endpoint. The only reliable way to observe it
// is to put the window on XWayland and grab the X root. Everything odd in this
// file exists because of one of the four traps documented in SKILL.md.
//
//   node .claude/skills/run-terra/driver.mjs themes
//   node .claude/skills/run-terra/driver.mjs shot --theme nothing --mode light --out /tmp/a.png
//   node .claude/skills/run-terra/driver.mjs shot-all --outdir /tmp/terra-shots

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const APP_ID = "app.kevsmir02.terra";
const SETTINGS = join(homedir(), ".local/share", APP_ID, "terra-settings.json");
const BIN = join(ROOT, "src-tauri/target/debug/terra");
const VITE_URL = "http://localhost:1420";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function die(msg) {
  console.error(`driver: ${msg}`);
  process.exit(1);
}

/** Builtin theme ids, read from source so the list cannot go stale. */
function themes() {
  const out = sh("grep", ["-rhoE", 'id: "[a-z0-9-]+"', "src/modules/theme/themes/"]);
  const ids = [...new Set((out.stdout || "").match(/"[a-z0-9-]+"/g) || [])]
    .map((s) => s.replaceAll('"', ""))
    .filter((s) => s !== "transparent");
  return ids.sort();
}

function viteUp() {
  return sh("curl", ["-sf", "-o", "/dev/null", VITE_URL]).status === 0;
}

async function startVite() {
  // Detached: a plain child dies when this process exits, and the app window
  // never appears without a frontend to load.
  const p = spawn("pnpm", ["dev"], { cwd: ROOT, detached: true, stdio: "ignore" });
  p.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (viteUp()) return p.pid;
  }
  die("vite did not come up on :1420 within 60s");
}

/** Unique colour count of the X root. 1 means nothing is mapped on XWayland. */
function rootColours(tmp) {
  if (sh("magick", ["x:root", tmp]).status !== 0) return 0;
  const r = sh("magick", ["identify", "-format", "%k", tmp]);
  return Number.parseInt(r.stdout || "0", 10) || 0;
}

function readSettings() {
  if (!existsSync(SETTINGS)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(obj) {
  mkdirSync(join(homedir(), ".local/share", APP_ID), { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(obj));
}

/**
 * Launch, wait for the window to actually paint, capture, kill.
 * Returns the unique-colour count so callers can spot a blank frame.
 */
async function capture(out, waitMax = 25) {
  if (!existsSync(BIN)) {
    die(`no debug binary at ${BIN}. Run: cd src-tauri && cargo build`);
  }
  const child = spawn(BIN, [], {
    cwd: ROOT,
    // Tauri defaults to the Wayland GDK backend, which renders nothing into the
    // X root and so cannot be captured. Forcing x11 routes it via XWayland.
    env: { ...process.env, GDK_BACKEND: "x11" },
    detached: true,
    stdio: "ignore",
  });
  const pid = child.pid;
  try {
    let colours = 0;
    for (let i = 0; i < waitMax; i++) {
      await sleep(1000);
      colours = rootColours(out);
      // The window is `visible: false` until the frontend boots and calls
      // show(), so an all-one-colour root means it has not painted yet.
      if (colours > 50) {
        await sleep(2000); // let the first paint settle
        rootColours(out);
        break;
      }
    }
    return colours;
  } finally {
    // Never pkill -f on the binary path: that pattern also matches the calling
    // agent's own shell command line and kills the session.
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
    await sleep(2500);
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

async function withTheme(id, mode, fn) {
  const before = readSettings();
  try {
    writeSettings({ ...before, themeId: id, theme: mode });
    return await fn();
  } finally {
    writeSettings(before);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? dflt : rest[i + 1];
  };

  if (cmd === "themes") {
    console.log(themes().join("\n"));
    return;
  }

  if (cmd !== "shot" && cmd !== "shot-all") {
    die("usage: driver.mjs themes | shot [--theme X --mode Y --out P] | shot-all [--outdir D]");
  }

  let viteOwned = null;
  if (!viteUp()) {
    console.error("driver: starting vite (not reachable on :1420)");
    viteOwned = await startVite();
  }

  try {
    const mode = arg("mode", "dark");
    const list =
      cmd === "shot-all" ? themes() : [arg("theme", "terra-default")];
    const outdir = arg("outdir", "/tmp/terra-shots");
    if (cmd === "shot-all") mkdirSync(outdir, { recursive: true });

    for (const id of list) {
      const out =
        cmd === "shot-all" ? join(outdir, `${id}-${mode}.png`) : arg("out", "/tmp/terra.png");
      const colours = await withTheme(id, mode, () => capture(out));
      const verdict = colours > 50 ? "ok" : "BLANK - window never painted";
      console.log(`${id.padEnd(16)} ${String(mode).padEnd(7)} ${out}  (${colours} colours, ${verdict})`);
    }
  } finally {
    if (viteOwned) {
      try {
        process.kill(-viteOwned, "SIGTERM");
      } catch {}
      try {
        process.kill(viteOwned, "SIGTERM");
      } catch {}
    }
  }
}

main().catch((e) => die(e?.stack || String(e)));
