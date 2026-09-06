import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookSrc = readFileSync(path.join(here, "useSdkSetup.ts"), "utf8");
const offerSrc = readFileSync(path.join(here, "InstallEmulator.tsx"), "utf8");
const emptySrc = readFileSync(path.join(here, "emptyStates.tsx"), "utf8");
const paneSrc = readFileSync(path.join(here, "DevicePreviewPane.tsx"), "utf8");
const appSrc = readFileSync(
  path.join(here, "..", "..", "app", "App.tsx"),
  "utf8",
);

describe("the SDK install offer stays dormant", () => {
  // The budget invariant: nothing in this module may tick while the user has
  // not started an install. The poll exists only to notice an image landing on
  // disk during one, because the download runs in a terminal tab whose exit
  // code this hook never sees.
  it("runs its poll only while an install is in flight", () => {
    const poll = hookSrc.slice(hookSrc.indexOf("setInterval"));
    expect(hookSrc).toMatch(
      /if \(!installing\) return;\s*\n\s*const id = setInterval/,
    );
    expect(poll).toMatch(/return \(\) => clearInterval\(id\)/);
    expect(hookSrc.match(/setInterval/g)).toHaveLength(1);
  });

  it("never spawns the downloader itself", () => {
    // Terra resolves the command and hands it to a terminal tab; running it
    // here would mean accepting Google's licences on the user's behalf.
    expect(hookSrc).not.toMatch(/Command|spawn/);
    expect(hookSrc).toMatch(/device_sdk_install_command/);
    expect(hookSrc).toMatch(/runInTerminal\(command\)/);
  });
});

describe("the offer is withheld when it cannot be honoured", () => {
  it("falls back to instructions when blocked or without a terminal host", () => {
    expect(offerSrc).toMatch(
      /if \(setup\.stage === "blocked" \|\| !runInTerminal\)/,
    );
  });

  it("guards the install call on the host callback too", () => {
    expect(hookSrc).toMatch(/if \(!runInTerminal\) return;/);
  });
});

describe("the first-run state can reach the offer", () => {
  // The regression this locks: with no SDK at all `adb` never resolves, so the
  // pane rendered AdbMissing, which was a dead end. The one state that needs
  // the offer most was the one state that could not show it.
  it("renders the create-or-install flow from the adb-missing state", () => {
    expect(emptySrc).toMatch(
      /export function AdbMissing\(\{[\s\S]{0,700}<CreateAvd/,
    );
    expect(paneSrc).toMatch(
      /adb-missing"[\s\S]{0,160}<AdbMissing[\s\S]{0,120}runInTerminal=\{runInTerminal\}/,
    );
  });

  // ADR 0002: Terra is Linux only, and these were never the right advice on it.
  it("names no foreign package manager", () => {
    for (const src of [emptySrc, offerSrc]) {
      expect(src).not.toMatch(/apt install|brew install|winget install/);
    }
  });
});

describe("App wires the terminal host into both device surfaces", () => {
  // Without this the offer degrades silently to the old dead end, since
  // `runInTerminal` is optional all the way down.
  it("passes runInTerminal to the dock and the picker", () => {
    expect(appSrc).toMatch(
      /<DeviceDock[\s\S]{0,200}runInTerminal=\{runInTerminal\}/,
    );
    expect(appSrc).toMatch(
      /<DeviceDropdown[\s\S]{0,200}runInTerminal=\{runInTerminal\}/,
    );
  });
});
