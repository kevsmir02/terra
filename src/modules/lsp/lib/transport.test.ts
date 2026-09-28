import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  channels: [] as { onmessage: (m: unknown) => void }[],
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (m: unknown) => void = () => {};
    constructor() {
      h.channels.push(this);
    }
  },
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    h.calls.push({ cmd, args });
    return cmd === "lsp_spawn" ? 7 : null;
  },
}));

import { replyToServerRequest, TauriLspTransport } from "./transport";

const encode = (s: string) => new TextEncoder().encode(s).buffer;

function request(method: string, params?: unknown, id: unknown = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

describe("replyToServerRequest", () => {
  it("answers workspace/configuration with one null per item", () => {
    const reply = replyToServerRequest(
      request("workspace/configuration", { items: [{}, {}] }, "c1"),
    );
    expect(JSON.parse(reply ?? "")).toEqual({
      jsonrpc: "2.0",
      id: "c1",
      result: [null, null],
    });
  });

  it("does not throw on malformed configuration params", () => {
    for (const params of [undefined, { items: "x" }, { items: { a: 1 } }]) {
      const reply = replyToServerRequest(
        request("workspace/configuration", params),
      );
      expect(JSON.parse(reply ?? "").result).toEqual([]);
    }
  });

  it("rejects an unknown request with method-not-found", () => {
    const reply = JSON.parse(
      replyToServerRequest(request("custom/thing")) ?? "",
    );
    expect(reply.error.code).toBe(-32601);
    expect(reply.id).toBe(1);
  });

  it("never replies to notifications, responses or garbage", () => {
    const cases = [
      JSON.stringify({ jsonrpc: "2.0", method: "window/logMessage" }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { method: "x" } }),
      JSON.stringify({ jsonrpc: "2.0", id: null, method: "x" }),
      JSON.stringify({ jsonrpc: "2.0", id: { a: 1 }, method: "x" }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: 5 }),
      '{"id": 1, "method": ',
      "[]",
    ];
    for (const text of cases) expect(replyToServerRequest(text)).toBeNull();
  });
});

describe("TauriLspTransport", () => {
  beforeEach(() => {
    h.channels.length = 0;
    h.calls.length = 0;
  });

  async function started() {
    const t = new TauriLspTransport();
    await t.start({ command: "x", args: [], root: "/r" });
    const [messages, exit] = h.channels;
    return { t, messages, exit };
  }

  it("queues messages that arrive before a listener, in order", async () => {
    const { t, messages } = await started();
    messages.onmessage(encode('{"n":1}'));
    messages.onmessage(encode('{"n":2}'));
    const got: string[] = [];
    t.onMessage((m) => got.push(m));
    messages.onmessage(encode('{"n":3}'));
    expect(got).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it("answers a server request over the pipe and still forwards it", async () => {
    const { t, messages } = await started();
    const got: string[] = [];
    t.onMessage((m) => got.push(m));
    messages.onmessage(encode(request("client/registerCapability", {}, 9)));
    const sent = h.calls.filter((c) => c.cmd === "lsp_send");
    expect(sent).toHaveLength(1);
    expect(sent[0].args.id).toBe(7);
    expect(JSON.parse(String(sent[0].args.message))).toMatchObject({
      id: 9,
      result: null,
    });
    expect(got).toHaveLength(1);
  });

  it("drops sends after the server exits and never kills it twice", async () => {
    const { t, exit } = await started();
    let closes = 0;
    exit.onmessage({ code: 1, stderrTail: "", reason: null });
    t.onClose(() => closes++);
    expect(closes).toBe(1);
    t.send("{}");
    t.close();
    expect(h.calls.map((c) => c.cmd)).toEqual(["lsp_spawn"]);
  });

  it("kills a live server once on close", async () => {
    const { t } = await started();
    t.close();
    t.close();
    t.send("{}");
    expect(h.calls.map((c) => c.cmd)).toEqual(["lsp_spawn", "lsp_kill"]);
  });
});
