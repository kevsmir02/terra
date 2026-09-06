import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookSrc = readFileSync(path.join(here, "useSdkSetup.ts"), "utf8");
const offerSrc = readFileSync(path.join(here, "InstallEmulator.tsx"), "utf8");
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
  it("falls back to instructions without sdkmanager or a terminal host", () => {
    expect(offerSrc).toMatch(/if \(!setup\.canInstall \|\| !runInTerminal\)/);
  });

  it("guards the install call on the host callback too", () => {
    expect(hookSrc).toMatch(/if \(!runInTerminal\) return;/);
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
