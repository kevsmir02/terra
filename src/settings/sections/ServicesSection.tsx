import { usePreferencesStore } from "@/modules/settings/preferences";
import { setServicesConfig } from "@/modules/settings/store";
import {
  generatePassword,
  LogsDrawer,
  RuntimeCard,
  SERVICE_META,
  ServiceRow,
  type RowStatus,
  type RuntimeStatus,
  type ServiceId,
  type ServicesConfig,
  VOLUME_BY_ID,
} from "@/modules/services";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";

type ServiceStatus = { service: string; state: string; health: string | null };

const POLL_MS = 3000;

function toRowStatus(s: ServiceStatus | undefined): RowStatus {
  if (s?.state !== "running") return "stopped";
  if (s.health === "starting") return "starting";
  if (s.health === "unhealthy") return "unhealthy";
  return "healthy";
}

export function ServicesSection() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const [busyId, setBusyId] = useState<ServiceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = status?.state === "ready";
  const config = usePreferencesStore((s) => s.services);

  const poll = useCallback(async () => {
    try {
      const rows = await invoke<ServiceStatus[]>("services_status");
      setStatuses(Object.fromEntries(rows.map((r) => [r.service, r])));
    } catch {
      // Runtime vanished mid-poll; keep the last known state.
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [ready, poll]);

  const toggle = useCallback(
    async (id: ServiceId, next: boolean) => {
      const enabled = next
        ? Array.from(new Set([...config.services, id]))
        : config.services.filter((s) => s !== id);
      const spec: ServicesConfig = {
        ...config,
        services: enabled,
        dbPassword: config.dbPassword || generatePassword(),
      };
      await setServicesConfig(spec);
      setBusyId(id);
      setError(null);
      try {
        await invoke(next ? "services_up" : "services_down", { spec });
        await poll();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusyId(null);
      }
    },
    [config, poll],
  );

  const setPort = useCallback(
    async (id: ServiceId, port: number) => {
      await setServicesConfig({
        ...config,
        ports: { ...config.ports, [id]: port },
      });
    },
    [config],
  );

  const deleteData = useCallback(
    async (volume: string) => {
      setError(null);
      try {
        await invoke("services_delete_data", { volume });
        await poll();
      } catch (e) {
        setError(String(e));
      }
    },
    [poll],
  );

  return (
    <div className="space-y-4">
      <RuntimeCard onStatus={setStatus} />
      {!ready && (
        <p className="text-muted-foreground text-xs">
          Services become available once a container runtime is ready.
        </p>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
      {ready && (
        <div className="space-y-3">
          {(Object.keys(SERVICE_META) as ServiceId[]).map((id) => {
            const meta = SERVICE_META[id];
            const port = config.ports[id] ?? meta.defaultPort;
            // Mailpit and the web tier do not take a port override: mailpit
            // publishes two fixed ports and web ports come from the site list.
            const portEditable = id !== "mailpit" && id !== "web";
            return (
              <div key={id} className="space-y-1.5">
                <ServiceRow
                  id={id}
                  label={meta.label}
                  port={port}
                  status={toRowStatus(statuses[meta.composeName])}
                  enabled={config.services.includes(id)}
                  busy={busyId === id}
                  password={config.dbPassword}
                  onToggle={(next) => void toggle(id, next)}
                  onPortChange={
                    portEditable
                      ? (next) => void setPort(id, next)
                      : () => undefined
                  }
                  onOpen={() => void openUrl(`http://localhost:${port}`)}
                  onDeleteData={() => {
                    const volume = VOLUME_BY_ID[id];
                    if (volume) void deleteData(volume);
                  }}
                />
                <LogsDrawer service={meta.composeName} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
