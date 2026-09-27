import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LspExitInfo, LspSpawnConfig } from "./transport";

// The manager talks to the Rust pipe (invoke), a lazily imported client and
// transport, and sonner. All four are faked; the policy and bookkeeping run
// for real, including the preferences and runtime stores.
const h = vi.hoisted(() => {
  type FakeTransport = {
    config: LspSpawnConfig | null;
    exitInfo: LspExitInfo | null;
    closed: boolean;
    start: (c: LspSpawnConfig) => Promise<void>;
    close: () => void;
  };
  type FakeClient = {
    onClose: () => void;
    closed: boolean;
    shutdowns: number;
    didClose: string[];
    initializePromise: Promise<void>;
    textDocumentDidClose: (uri: string) => void;
    textDocumentDidSave: (uri: string) => void;
    shutdownGracefully: () => Promise<void>;
    close: () => void;
  };
  return {
    roots: new Map<string, string | null>(),
    transports: [] as FakeTransport[],
    clients: [] as FakeClient[],
    failSpawn: false,
    toastError: (..._args: unknown[]) => {},
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { path?: string }) => {
    if (cmd === "lsp_resolve_root") return h.roots.get(args.path ?? "") ?? null;
    if (cmd === "lsp_host_pid") return 1;
    throw new Error(`unexpected invoke ${cmd}`);
  },
}));

vi.mock("./detect", () => ({
  detectBinary: async (command: string) => `/usr/bin/${command}`,
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => h.toastError(...args) },
}));

vi.mock("./transport", () => ({
  TauriLspTransport: class {
    config: LspSpawnConfig | null = null;
    exitInfo: LspExitInfo | null = null;
    closed = false;
    constructor() {
      h.transports.push(this);
    }
    async start(config: LspSpawnConfig) {
      if (h.failSpawn) throw new Error("spawn failed");
      this.config = config;
    }
    close() {
      this.closed = true;
    }
  },
}));

vi.mock("./client", () => ({
  SynchronizationMethod: { Incremental: 2 },
  lspInteractions: () => [],
  languageServerWithTransport: () => [],
  formatDocumentAndWait: async () => "done",
  TerraLspClient: class {
    static hostPid: number | null = null;
    onClose: () => void;
    closed = false;
    shutdowns = 0;
    didClose: string[] = [];
    initializePromise = Promise.resolve();
    constructor(opts: { onClose: () => void }) {
      this.onClose = opts.onClose;
      h.clients.push(this);
    }
    textDocumentDidClose(uri: string) {
      this.didClose.push(uri);
    }
    textDocumentDidSave() {}
    async shutdownGracefully() {
      this.shutdowns += 1;
    }
    close() {
      this.closed = true;
    }
  },
}));

type Manager = typeof import("./sessionManager");
type Runtime = typeof import("./runtimeStore");
type Prefs = typeof import("@/modules/settings/preferences");

let manager: Manager;
let runtime: Runtime["useLspRuntimeStore"];
let prefs: Prefs["usePreferencesStore"];

const RUST = "rust-analyzer";

function project(i: number): string {
  const root = `/work/p${i}`;
  h.roots.set(`${root}/src/main.rs`, root);
  return `${root}/src/main.rs`;
}

function live(): number {
  return h.transports.filter((t) => !t.closed && t.config).length;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.resetModules();
  h.roots.clear();
  h.transports.length = 0;
  h.clients.length = 0;
  h.failSpawn = false;
  h.toastError = vi.fn();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  manager = await import("./sessionManager");
  runtime = (await import("./runtimeStore")).useLspRuntimeStore;
  prefs = (await import("@/modules/settings/preferences")).usePreferencesStore;
  prefs.setState({ lspActivation: { [RUST]: "enabled" } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("activation gate", () => {
  it("spawns nothing for a server that is not enabled", async () => {
    prefs.setState({ lspActivation: { [RUST]: "dismissed" } });
    expect(await manager.acquireDocExtension(project(1), "rs")).toBeNull();
    prefs.setState({ lspActivation: {} });
    expect(await manager.acquireDocExtension(project(1), "rs")).toBeNull();
    expect(h.transports).toEqual([]);
  });

  it("stops every session when the server is disabled", async () => {
    await manager.acquireDocExtension(project(1), "rs");
    await manager.acquireDocExtension(project(2), "rs");
    expect(live()).toBe(2);
    prefs.setState({ lspActivation: { [RUST]: "dismissed" } });
    await flush();
    expect(live()).toBe(0);
    expect(Object.keys(runtime.getState().sessions)).toEqual([]);
  });
});

describe("no root marker, no session", () => {
  it("refuses a file with no project root", async () => {
    h.roots.set("/tmp/loose.rs", null);
    expect(await manager.acquireDocExtension("/tmp/loose.rs", "rs")).toBeNull();
    expect(h.transports).toEqual([]);
  });

  it("shares one server across files of the same root", async () => {
    const a = project(1);
    h.roots.set("/work/p1/src/lib.rs", "/work/p1");
    await manager.acquireDocExtension(a, "rs");
    await manager.acquireDocExtension("/work/p1/src/lib.rs", "rs");
    expect(h.transports).toHaveLength(1);
    expect(h.transports[0].config?.root).toBe("/work/p1");
  });
});

describe("session cap", () => {
  it("refuses a fifth root while four servers hold open documents", async () => {
    for (let i = 1; i <= 4; i++) {
      expect(
        await manager.acquireDocExtension(project(i), "rs"),
      ).not.toBeNull();
    }
    expect(await manager.acquireDocExtension(project(5), "rs")).toBeNull();
    expect(h.transports).toHaveLength(4);
  });

  it("counts spawns still in flight, so a burst cannot overshoot", async () => {
    const opens = [1, 2, 3, 4, 5, 6].map((i) =>
      manager.acquireDocExtension(project(i), "rs"),
    );
    const handles = await Promise.all(opens);
    expect(handles.filter(Boolean)).toHaveLength(4);
    expect(h.transports).toHaveLength(4);
  });

  it("makes room by evicting idle servers old enough to evict", async () => {
    for (let i = 1; i <= 4; i++) {
      (await manager.acquireDocExtension(project(i), "rs"))?.release();
    }
    vi.advanceTimersByTime(11_000);
    expect(await manager.acquireDocExtension(project(5), "rs")).not.toBeNull();
    await flush();
    expect(live()).toBe(1);
  });

  it("never evicts a newborn idle sibling", async () => {
    (await manager.acquireDocExtension(project(1), "rs"))?.release();
    await manager.acquireDocExtension(project(2), "rs");
    await flush();
    expect(live()).toBe(2);
  });
});

describe("idle shutdown", () => {
  it("kills a server three minutes after its last document closes", async () => {
    const path = project(1);
    const handle = await manager.acquireDocExtension(path, "rs");
    handle?.release();
    vi.advanceTimersByTime(3 * 60 * 1000 - 1);
    expect(live()).toBe(1);
    vi.advanceTimersByTime(1);
    await flush();
    expect(h.clients[0].shutdowns).toBe(1);
    expect(live()).toBe(0);
  });

  it("a reopen inside the window cancels the kill", async () => {
    const path = project(1);
    (await manager.acquireDocExtension(path, "rs"))?.release();
    vi.advanceTimersByTime(60_000);
    await manager.acquireDocExtension(path, "rs");
    vi.advanceTimersByTime(10 * 60 * 1000);
    await flush();
    expect(live()).toBe(1);
    expect(h.transports).toHaveLength(1);
  });

  it("keeps the document open until its last handle releases, once", async () => {
    const path = project(1);
    const a = await manager.acquireDocExtension(path, "rs");
    const b = await manager.acquireDocExtension(path, "rs");
    a?.release();
    a?.release();
    expect(h.clients[0].didClose).toEqual([]);
    b?.release();
    expect(h.clients[0].didClose).toHaveLength(1);
  });
});

describe("crash backoff", () => {
  function crash(): void {
    const t = h.transports[h.transports.length - 1];
    if (!t) throw new Error("no server to crash");
    t.exitInfo = { code: 101, stderrTail: "panic", reason: null };
    t.closed = true;
    h.clients[h.clients.length - 1]?.onClose();
  }

  it("delays the respawn trigger by the cooldown", async () => {
    await manager.acquireDocExtension(project(1), "rs");
    crash();
    const before = runtime.getState().generations[RUST] ?? 0;
    vi.advanceTimersByTime(1_999);
    expect(runtime.getState().generations[RUST] ?? 0).toBe(before);
    vi.advanceTimersByTime(1);
    expect(runtime.getState().generations[RUST]).toBe(before + 1);
  });

  it("gives up after three crashes inside five minutes", async () => {
    const path = project(1);
    for (let n = 0; n < 3; n++) {
      expect(await manager.acquireDocExtension(path, "rs")).not.toBeNull();
      crash();
      vi.advanceTimersByTime(30_000);
    }
    expect(await manager.acquireDocExtension(path, "rs")).toBeNull();
    expect(h.transports).toHaveLength(3);
    expect(runtime.getState().failed[RUST]).toContain("panic");
  });

  it("tries again once the oldest crash leaves the window", async () => {
    const path = project(1);
    for (let n = 0; n < 3; n++) {
      await manager.acquireDocExtension(path, "rs");
      crash();
    }
    expect(await manager.acquireDocExtension(path, "rs")).toBeNull();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(await manager.acquireDocExtension(path, "rs")).not.toBeNull();
  });

  it("a budget kill gives up at once instead of respawning", async () => {
    const path = project(1);
    await manager.acquireDocExtension(path, "rs");
    const t = h.transports[0];
    t.exitInfo = { code: null, stderrTail: "", reason: "over 2048 MB" };
    h.clients[0].onClose();
    expect(runtime.getState().failed[RUST]).toBe("over 2048 MB");
    const before = runtime.getState().generations[RUST] ?? 0;
    vi.advanceTimersByTime(60_000);
    expect(runtime.getState().generations[RUST] ?? 0).toBe(before);
    expect(await manager.acquireDocExtension(path, "rs")).toBeNull();
  });

  it("counts a failed spawn as a crash", async () => {
    h.failSpawn = true;
    const path = project(1);
    for (let n = 0; n < 3; n++) {
      expect(await manager.acquireDocExtension(path, "rs")).toBeNull();
    }
    h.failSpawn = false;
    expect(await manager.acquireDocExtension(path, "rs")).toBeNull();
    expect(h.transports).toHaveLength(3);
  });

  it("an explicit restart clears the give-up", async () => {
    const path = project(1);
    for (let n = 0; n < 3; n++) {
      await manager.acquireDocExtension(path, "rs");
      crash();
    }
    await manager.restartPresetSessions(RUST);
    expect(runtime.getState().failed[RUST]).toBeUndefined();
    expect(await manager.acquireDocExtension(path, "rs")).not.toBeNull();
  });
});
