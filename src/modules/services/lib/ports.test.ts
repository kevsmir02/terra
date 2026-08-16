import { MAX_PORT, MIN_PORT, parsePort } from "@/modules/services/lib/config";
import { describe, expect, it } from "vitest";

describe("parsePort", () => {
  it("accepts a port the Rust validator would also accept", () => {
    expect(parsePort("3307")).toBe(3307);
    expect(parsePort(" 8080 ")).toBe(8080);
    expect(parsePort(String(MIN_PORT))).toBe(MIN_PORT);
    expect(parsePort(String(MAX_PORT))).toBe(MAX_PORT);
  });

  it("rejects a cleared field instead of saving port 0", () => {
    expect(parsePort("")).toBeNull();
    expect(parsePort("   ")).toBeNull();
    expect(parsePort("0")).toBeNull();
  });

  it("rejects anything that would overflow u16 on the Rust side", () => {
    // 99999 used to deserialize-fail the whole start with a raw serde error.
    expect(parsePort("99999")).toBeNull();
    expect(parsePort(String(MAX_PORT + 1))).toBeNull();
  });

  it("rejects privileged ports so rootless podman keeps working", () => {
    expect(parsePort("80")).toBeNull();
    expect(parsePort(String(MIN_PORT - 1))).toBeNull();
  });

  it("rejects text that Number() would otherwise coerce", () => {
    expect(parsePort("8080abc")).toBeNull();
    expect(parsePort("-8080")).toBeNull();
    expect(parsePort("80.80")).toBeNull();
    expect(parsePort("1e4")).toBeNull();
  });
});
