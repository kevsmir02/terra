import { describe, expect, it } from "vitest";
import { shouldMountPill } from "@/modules/services/lib/pillGate";

describe("shouldMountPill", () => {
  it("stays out of the way until services are enabled", () => {
    expect(shouldMountPill({ services: [] })).toBe(false);
    expect(shouldMountPill(undefined)).toBe(false);
  });

  it("mounts once any service is enabled", () => {
    expect(shouldMountPill({ services: ["mariadb"] })).toBe(true);
  });
});
