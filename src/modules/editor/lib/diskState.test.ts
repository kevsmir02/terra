import { describe, expect, it } from "vitest";
import { type DiskState, nextDiskState } from "./diskState";

describe("nextDiskState", () => {
  it("flags a dirty buffer when the disk moves under it", () => {
    expect(nextDiskState("in-sync", { kind: "reload-skipped-dirty" })).toBe(
      "changed",
    );
  });

  it("keeps reporting a missing file when a later event cannot be read", () => {
    // The buffer is dirty so the file was never re-read; nothing proves it came
    // back, and "Save to recreate" is still the correct offer.
    expect(nextDiskState("missing", { kind: "reload-skipped-dirty" })).toBe(
      "missing",
    );
  });

  it("stays flagged while the buffer remains dirty", () => {
    expect(nextDiskState("changed", { kind: "reload-skipped-dirty" })).toBe(
      "changed",
    );
  });

  it("clears once the file is re-read successfully", () => {
    expect(nextDiskState("changed", { kind: "reload-succeeded" })).toBe(
      "in-sync",
    );
  });

  it("clears a missing flag when the file reads again", () => {
    expect(nextDiskState("missing", { kind: "reload-succeeded" })).toBe(
      "in-sync",
    );
  });

  it("marks the file missing once its absence is confirmed", () => {
    expect(nextDiskState("in-sync", { kind: "confirmed-missing" })).toBe(
      "missing",
    );
  });

  it("lets a confirmed deletion supersede a pending change flag", () => {
    expect(nextDiskState("changed", { kind: "confirmed-missing" })).toBe(
      "missing",
    );
  });

  it("resolves on save, since the user's version becomes the disk version", () => {
    expect(nextDiskState("changed", { kind: "saved" })).toBe("in-sync");
  });

  it("resolves on save after a deletion, since saving recreates the file", () => {
    expect(nextDiskState("missing", { kind: "saved" })).toBe("in-sync");
  });

  it("resolves when the user discards their edits for the disk copy", () => {
    expect(nextDiskState("changed", { kind: "discarded" })).toBe("in-sync");
  });

  it("is a no-op for every event that finds nothing to resolve", () => {
    const states: DiskState[] = ["in-sync", "changed", "missing"];
    for (const s of states) {
      expect(nextDiskState(s, { kind: "reload-succeeded" })).toBe("in-sync");
    }
  });
});
