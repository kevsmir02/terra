import { invoke } from "@tauri-apps/api/core";

export type RuntimeName = "docker" | "podman";

export type RuntimeStatus =
  | { state: "not-found" }
  | { state: "no-compose"; runtime: RuntimeName }
  | { state: "unreachable"; runtime: RuntimeName }
  | { state: "ready"; runtime: RuntimeName; version: string };

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

export function probeRuntime(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("services_runtime_probe");
}
