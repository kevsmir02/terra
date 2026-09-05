import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectingOverlay, DisconnectedOverlay, PaneFallback } from "./DevicePreviewPane";
import { NoDevices, ServerFailed, UnauthorizedDevice } from "./emptyStates";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
  Channel: class {},
}));

const here = path.dirname(fileURLToPath(import.meta.url));

// The empty states are hook-free apart from NoDevices, so their element trees
// can be walked directly to reach the Refresh / Reconnect button.
function findButton(node: ReactNode): ReactElement<{ onClick: () => void }> | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ onClick?: () => void; children?: ReactNode }>;
  if (el.type === "button" && typeof el.props.onClick === "function") {
    return el as ReactElement<{ onClick: () => void }>;
  }
  const children = el.props.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findButton(child);
    if (found) return found;
  }
  return null;
}

function clickButton(tree: ReactNode) {
  const button = findButton(tree);
  if (!button) throw new Error("no button in tree");
  button.props.onClick();
}

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (!isValidElement(node)) return "";
  return collectText((node as ReactElement<{ children?: ReactNode }>).props.children);
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  vi.stubGlobal("location", { reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaneFallback refresh", () => {
  it("hands the session retry to the no-devices state instead of reloading the window", () => {
    const onRetry = vi.fn();
    const el = PaneFallback({ status: { kind: "no-devices" }, onRetry }) as ReactElement<{
      onRefresh: () => void;
    }>;

    expect(el.type).toBe(NoDevices);
    el.props.onRefresh();

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("wires the unauthorized state's Refresh button to the session retry", () => {
    const onRetry = vi.fn();
    const el = PaneFallback({
      status: { kind: "unauthorized", serial: "emulator-5554" },
      onRetry,
    }) as ReactElement<{ serial: string; onRefresh: () => void }>;

    expect(el.type).toBe(UnauthorizedDevice);
    expect(el.props.serial).toBe("emulator-5554");
    clickButton(UnauthorizedDevice(el.props));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("offers Retry on a server failure instead of leaving a dead end", () => {
    const onRetry = vi.fn();
    const el = PaneFallback({
      status: { kind: "error", message: "device already open" },
      onRetry,
    }) as ReactElement<{ message: string; onRetry: () => void }>;

    expect(el.type).toBe(ServerFailed);
    expect(el.props.message).toBe("device already open");
    clickButton(ServerFailed(el.props));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the connecting overlay", () => {
  it("names what it is connecting to", () => {
    expect(collectText(ConnectingOverlay({ label: "Pixel 8" }))).toContain("Connecting to Pixel 8");
  });
});

describe("the disconnected overlay", () => {
  // The overlay sits over the frozen last frame, so its Reconnect is the only
  // way back: nothing in the module restarts a dead mirror on its own.
  it("names the reason and wires Reconnect to the session retry", () => {
    const onRetry = vi.fn();
    const tree = DisconnectedOverlay({
      message: "The mirror server could not be reached",
      onReconnect: onRetry,
    });

    expect(collectText(tree)).toContain("The mirror server could not be reached");
    clickButton(tree);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("SessionPane preflight status", () => {
  // A retry remounts SessionPane, so its initial status paints before start()
  // resolves anything. Starting at "connecting" (rather than a bare "idle")
  // keeps that first paint labeled as an active attempt, not a dead pause,
  // right after a fallback screen's error message.
  it("starts SessionPane in the connecting status, not an idle placeholder", () => {
    const src = readFileSync(path.join(here, "DevicePreviewPane.tsx"), "utf8");
    expect(src).toMatch(/useState<SessionStatus>\(\{\s*kind:\s*"connecting"\s*\}\)/);
    expect(src).not.toMatch(/kind:\s*"idle"/);
  });
});

describe("the device module never reloads the webview", () => {
  // A reload throws away every terminal and editor's in-memory state; the only
  // thing a device refresh may restart is its own session.
  it("has no location.reload in the pane, its session or the empty states", () => {
    for (const file of ["DevicePreviewPane.tsx", "deviceSession.ts", "emptyStates.tsx"]) {
      const src = readFileSync(path.join(here, file), "utf8");
      expect(src, file).not.toMatch(/location\.reload/);
    }
  });
});
