import { invoke } from "@tauri-apps/api/core";

export type RuntimeName = "docker" | "podman";

export type RuntimeStatus =
  | { state: "not-found" }
  | { state: "no-compose"; runtime: RuntimeName }
  | { state: "unreachable"; runtime: RuntimeName }
  | { state: "ready"; runtime: RuntimeName; version: string };

export type RuntimeProbeAll = {
  docker: RuntimeStatus;
  podman: RuntimeStatus;
};

const LABEL: Record<RuntimeName, string> = {
  docker: "Docker",
  podman: "Podman",
};

export type RuntimeMessage = { title: string; detail: string; ok: boolean };

export function runtimeMessage(status: RuntimeStatus): RuntimeMessage {
  switch (status.state) {
    case "not-found":
      return {
        title: "No container runtime found",
        detail:
          "Install Docker Desktop or Podman to run local services. Terra never installs it for you.",
        ok: false,
      };
    case "no-compose":
      return {
        title: `${LABEL[status.runtime]} has no compose provider`,
        detail:
          "The runtime is installed but cannot run compose. Install the compose plugin, then probe again.",
        ok: false,
      };
    case "unreachable":
      return {
        title: `${LABEL[status.runtime]} is not running`,
        detail:
          status.runtime === "docker"
            ? "Start Docker Desktop, or run: systemctl --user start docker"
            : "Start the Podman service, or run: systemctl --user start podman.socket",
        ok: false,
      };
    case "ready":
      return {
        title: `${LABEL[status.runtime]} ready`,
        detail: `compose ${status.version}`,
        ok: true,
      };
  }
}

/** A forced runtime always keeps its picker on screen. Showing it only when
 * both runtimes are ready stranded anyone whose forced choice stopped working:
 * the service list hid itself and the control to undo the choice went with
 * it. */
export function shouldShowRuntimePicker(
  probes: RuntimeProbeAll | null,
  override: RuntimeName | null,
): boolean {
  if (override !== null) return true;
  return probes?.docker.state === "ready" && probes.podman.state === "ready";
}

export function probeRuntimeAll(): Promise<RuntimeProbeAll> {
  return invoke<RuntimeProbeAll>("services_runtime_probe_all");
}
