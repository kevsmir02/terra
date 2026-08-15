import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type JSX, useEffect, useState } from "react";

type ServiceStatus = {
  service: string;
  state: string;
  health: string | null;
};

const POLL_MS = 5000;

export function ServicesPill(): JSX.Element | null {
  const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
  const [focused, setFocused] = useState(() =>
    typeof document === "undefined" ? true : document.hasFocus(),
  );

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    const window = getCurrentWebviewWindow();

    void window
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then((unsubscribe) => {
        if (alive) unlisten = unsubscribe;
        else unsubscribe();
      })
      .catch(() => undefined);

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!focused) return;
    let alive = true;

    const poll = async () => {
      try {
        const next = await invoke<ServiceStatus[]>("services_status");
        if (alive) setStatuses(next);
      } catch {
        // Runtime vanished mid-poll; keep the last known state.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [focused]);

  if (statuses.length === 0) return null;

  const healthy = statuses.filter(
    (status) => status.health === "healthy",
  ).length;

  return (
    <button
      type="button"
      className="terra-pill-in flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border/(--emph-medium) bg-accent/(--emph-medium) px-2 text-[10.5px] font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground"
      onClick={() => void openSettingsWindow("services")}
      title="Open services settings"
    >
      <span
        className={`size-1.5 rounded-full ${healthy > 0 ? "bg-status-ok" : "bg-muted"}`}
      />
      <span>{healthy}</span>
    </button>
  );
}
