import { describe, expect, it } from "vitest";
import {
  runtimeMessage,
  shouldShowRuntimePicker,
  type RuntimeStatus,
} from "@/modules/services/lib/runtime";

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

describe("shouldShowRuntimePicker", () => {
  const ready = (): RuntimeStatus => ({
    state: "ready",
    runtime: "docker",
    version: "5.4.0",
  });

  it("shows the picker when either runtime could be chosen", () => {
    expect(
      shouldShowRuntimePicker({ docker: ready(), podman: ready() }, null),
    ).toBe(true);
  });

  it("hides it when there is nothing to choose between", () => {
    expect(
      shouldShowRuntimePicker(
        { docker: ready(), podman: { state: "not-found" } },
        null,
      ),
    ).toBe(false);
    expect(shouldShowRuntimePicker(null, null)).toBe(false);
  });

  it("always shows it while a runtime is forced", () => {
    // Otherwise a forced choice that stops working hides the only control
    // that could undo it, and the whole services list with it.
    expect(
      shouldShowRuntimePicker(
        {
          docker: { state: "not-found" },
          podman: { state: "unreachable", runtime: "podman" },
        },
        "podman",
      ),
    ).toBe(true);
  });
});
