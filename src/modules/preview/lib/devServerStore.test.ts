import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chipLabel,
  ensureDevServerListener,
  nextEntry,
  openDevServer,
  setDevServerOpener,
  useDevServerStore,
} from "./devServerStore";

describe("nextEntry", () => {
  it("sets a candidate on a first detection", () => {
    expect(nextEntry(undefined, "http://localhost:5173")).toEqual({
      candidate: "http://localhost:5173",
      dismissed: null,
    });
  });

  it("ignores a URL the user already dismissed", () => {
    const entry = { candidate: null, dismissed: "http://localhost:5173" };
    expect(nextEntry(entry, "http://localhost:5173")).toBeNull();
  });

  it("prompts for a different URL even after a dismissal", () => {
    const entry = { candidate: null, dismissed: "http://localhost:5173" };
    expect(nextEntry(entry, "http://localhost:6006")).toEqual({
      candidate: "http://localhost:6006",
      dismissed: "http://localhost:5173",
    });
  });

  it("is a no-op when the candidate is already showing", () => {
    const entry = { candidate: "http://localhost:5173", dismissed: null };
    expect(nextEntry(entry, "http://localhost:5173")).toBeNull();
  });

  it("supersedes an undismissed candidate with a newer URL", () => {
    const entry = { candidate: "http://localhost:5173", dismissed: null };
    expect(nextEntry(entry, "http://localhost:8000")).toEqual({
      candidate: "http://localhost:8000",
      dismissed: null,
    });
  });
});

describe("chipLabel", () => {
  it("shows host and port", () => {
    expect(chipLabel("http://localhost:5173")).toBe("localhost:5173");
  });

  it("drops the path", () => {
    expect(chipLabel("http://127.0.0.1:8000/docs")).toBe("127.0.0.1:8000");
  });

  it("keeps the ipv6 literal readable", () => {
    expect(chipLabel("http://[::1]:4321")).toBe("[::1]:4321");
  });

  it("falls back to the raw string when the URL will not parse", () => {
    expect(chipLabel("not a url")).toBe("not a url");
  });
});

describe("useDevServerStore & actions", () => {
  beforeEach(() => {
    useDevServerStore.setState({ byLeaf: {} });
  });

  it("detects new dev server URL for a leaf", () => {
    useDevServerStore.getState().detect(1, "http://localhost:3000");
    expect(useDevServerStore.getState().byLeaf[1]).toEqual({
      candidate: "http://localhost:3000",
      dismissed: null,
    });
  });

  it("dismisses candidate URL for a leaf", () => {
    useDevServerStore.getState().detect(1, "http://localhost:3000");
    useDevServerStore.getState().dismiss(1);
    expect(useDevServerStore.getState().byLeaf[1]).toEqual({
      candidate: null,
      dismissed: "http://localhost:3000",
    });
  });

  it("clears leaf entry from store", () => {
    useDevServerStore.getState().detect(1, "http://localhost:3000");
    useDevServerStore.getState().clear(1);
    expect(useDevServerStore.getState().byLeaf[1]).toBeUndefined();
  });

  it("opens dev server URL and dismisses candidate", () => {
    const mockOpener = vi.fn();
    setDevServerOpener(mockOpener);

    useDevServerStore.getState().detect(1, "http://localhost:3000");
    openDevServer(1);

    expect(mockOpener).toHaveBeenCalledWith("http://localhost:3000");
    expect(useDevServerStore.getState().byLeaf[1]).toEqual({
      candidate: null,
      dismissed: "http://localhost:3000",
    });
  });

  it("does nothing when opening dev server without candidate", () => {
    const mockOpener = vi.fn();
    setDevServerOpener(mockOpener);

    openDevServer(1);
    expect(mockOpener).not.toHaveBeenCalled();
  });

  it("can be called safely to initialize dev server listener", () => {
    const mockResolveLeaf = vi.fn((ptyId: number) => ptyId);
    expect(() => ensureDevServerListener(mockResolveLeaf)).not.toThrow();
  });
});
