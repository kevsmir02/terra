import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(t: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => native);

const web = {
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(t: string) => Promise<void>>(),
};

const original = globalThis.navigator;
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";

function platform(userAgent: string) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent, clipboard: web },
  });
}

async function load() {
  vi.resetModules();
  return import("./terminalClipboard");
}

describe("terminalClipboard", () => {
  beforeEach(() => {
    native.readText.mockReset();
    native.writeText.mockReset();
    web.readText.mockReset();
    web.writeText.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: original,
    });
  });

  it("reads the native clipboard first", async () => {
    platform(LINUX);
    native.readText.mockResolvedValue("native");
    web.readText.mockResolvedValue("web");
    const { readTerminalClipboard } = await load();
    await expect(readTerminalClipboard()).resolves.toBe("native");
    expect(web.readText).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard when the native read fails", async () => {
    platform(LINUX);
    native.readText.mockRejectedValue(new Error("no ipc"));
    web.readText.mockResolvedValue("web");
    const { readTerminalClipboard } = await load();
    await expect(readTerminalClipboard()).resolves.toBe("web");
  });

  it("writes the native clipboard first", async () => {
    platform(LINUX);
    native.writeText.mockResolvedValue();
    const { writeTerminalClipboard } = await load();
    await writeTerminalClipboard("copied");
    expect(native.writeText).toHaveBeenCalledWith("copied");
    expect(web.writeText).not.toHaveBeenCalled();
  });

  // The write result is what lets a caller tell the user "Copied" only when
  // the text really landed. Reporting success on a silently swallowed failure
  // is worse than staying quiet.
  it("reports success after a native write", async () => {
    platform(LINUX);
    native.writeText.mockResolvedValue();
    const { writeTerminalClipboard } = await load();
    await expect(writeTerminalClipboard("copied")).resolves.toBe(true);
  });

  it("reports success when the native write fails but the web write lands", async () => {
    platform(LINUX);
    native.writeText.mockRejectedValue(new Error("no ipc"));
    web.writeText.mockResolvedValue();
    const { writeTerminalClipboard } = await load();
    await expect(writeTerminalClipboard("copied")).resolves.toBe(true);
    expect(web.writeText).toHaveBeenCalledWith("copied");
  });

  it("reports failure when every write path fails", async () => {
    platform(LINUX);
    native.writeText.mockRejectedValue(new Error("no ipc"));
    web.writeText.mockRejectedValue(new Error("denied"));
    const { writeTerminalClipboard } = await load();
    await expect(writeTerminalClipboard("copied")).resolves.toBe(false);
  });

  it("reports failure when no clipboard is available at all", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: LINUX },
    });
    native.writeText.mockRejectedValue(new Error("no ipc"));
    const { writeTerminalClipboard } = await load();
    await expect(writeTerminalClipboard("copied")).resolves.toBe(false);
  });
});
