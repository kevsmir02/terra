import { describe, expect, it } from "vitest";
import { runtimeMessage } from "@/modules/services/lib/runtime";

describe("runtimeMessage", () => {
  it("distinguishes the three failure states", () => {
    expect(runtimeMessage({ state: "not-found" }).title).toBe(
      "No container runtime found",
    );
    expect(
      runtimeMessage({ state: "no-compose", runtime: "podman" }).title,
    ).toBe("Podman has no compose provider");
    expect(
      runtimeMessage({ state: "unreachable", runtime: "docker" }).title,
    ).toBe("Docker is not running");
  });

  it("reports the runtime and version when ready", () => {
    expect(
      runtimeMessage({ state: "ready", runtime: "docker", version: "2.29.0" })
        .title,
    ).toBe("Docker ready");
  });

  it("only marks the ready state as usable", () => {
    expect(
      runtimeMessage({ state: "ready", runtime: "podman", version: "1" }).ok,
    ).toBe(true);
    expect(runtimeMessage({ state: "unreachable", runtime: "podman" }).ok).toBe(
      false,
    );
  });
});
