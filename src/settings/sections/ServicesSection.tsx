import { IS_WINDOWS } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setServicesConfig } from "@/modules/settings/store";
import { loadAll } from "@/modules/spaces/lib/store";
import { useSpaces } from "@/modules/spaces";
import {
  generatePassword,
  LogsDrawer,
  nextSitePort,
  probeRuntimeAll,
  RuntimeCard,
  SERVICE_META,
  ServiceRow,
  SitesTable,
  uniqueSlug,
  type RowStatus,
  type RuntimeProbeAll,
  type RuntimeStatus,
  type ServiceId,
  type ServicesConfig,
  type SiteRow,
  VOLUME_BY_ID,
} from "@/modules/services";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";

type ServiceStatus = { service: string; state: string; health: string | null };

type DetectedSite = {
  kind: "php" | "static";
  docroot: string;
  confident: boolean;
};

type StackSpec = Omit<ServicesConfig, "runtime">;

const FALLBACK_SITE: DetectedSite = {
  kind: "static",
  docroot: ".",
  confident: false,
};

const POLL_MS = 3000;

function toRowStatus(s: ServiceStatus | undefined): RowStatus {
  if (s?.state !== "running") return "stopped";
  if (s.health === "starting") return "starting";
  if (s.health === "unhealthy") return "unhealthy";
  return "healthy";
}

function selectEffectiveStatus(
  probes: RuntimeProbeAll | null,
  override: ServicesConfig["runtime"],
): RuntimeStatus | null {
  if (!probes) return null;
  if (override) return probes[override];
  if (probes.docker.state === "ready") return probes.docker;
  if (probes.podman.state === "ready") return probes.podman;

  const rank = (status: RuntimeStatus) => {
    switch (status.state) {
      case "unreachable":
        return 2;
      case "no-compose":
        return 1;
      default:
        return 0;
    }
  };
  return rank(probes.podman) > rank(probes.docker)
    ? probes.podman
    : probes.docker;
}

function sameEnv(
  left: SiteRow["env"] | undefined,
  right: SiteRow["env"],
): boolean {
  return (
    left?.kind === right.kind &&
    (right.kind === "local" ||
      (left?.kind === "wsl" && left.distro === right.distro))
  );
}

export function ServicesSection() {
  const [probes, setProbes] = useState<RuntimeProbeAll | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const [busyId, setBusyId] = useState<ServiceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = usePreferencesStore((s) => s.services);
  const preferencesHydrated = usePreferencesStore((s) => s.hydrated);
  const spaces = useSpaces((s) => s.spaces);
  const spacesHydrated = useSpaces((s) => s.hydrated);
  const [detections, setDetections] = useState<Record<string, DetectedSite>>(
    {},
  );
  const status = selectEffectiveStatus(probes, config.runtime);
  const ready = status?.state === "ready";

  const refreshRuntime = useCallback(async () => {
    setProbeBusy(true);
    try {
      setProbes(await probeRuntimeAll());
      setProbeError(null);
    } catch (e) {
      setProbeError(String(e));
    } finally {
      setProbeBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  useEffect(() => {
    let cancelled = false;
    void WebviewWindow.getByLabel("main").then((main) => {
      if (!cancelled) void main?.emit("terra:services-tab", true);
    });
    return () => {
      cancelled = true;
      void WebviewWindow.getByLabel("main").then((main) => {
        void main?.emit("terra:services-tab", false);
      });
    };
  }, []);

  useEffect(() => {
    if (spacesHydrated) return;
    void loadAll()
      .then(({ spaces: loaded, activeId }) => {
        useSpaces.getState().hydrate(loaded, activeId);
      })
      .catch(() => undefined);
  }, [spacesHydrated]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      spaces.map(async (space): Promise<[string, DetectedSite]> => {
        const root = space.root ?? "";
        if (!root) return [space.id, FALLBACK_SITE];
        try {
          return [
            space.id,
            await invoke<DetectedSite>("sites_detect", {
              root,
              env: space.env,
            }),
          ];
        } catch {
          return [space.id, FALLBACK_SITE];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setDetections(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [spaces]);

  const siteRows = useMemo<SiteRow[]>(() => {
    const savedById = new Map<string, (typeof config.sites)[number]>();
    const savedBySlug = new Map<string, (typeof config.sites)[number]>();
    for (const site of config.sites) {
      if (site.id) savedById.set(site.id, site);
      savedBySlug.set(site.slug, site);
    }
    const taken = config.sites.map((site) => site.port);
    const used = new Set<string>();
    return spaces.map((space) => {
      const slug = uniqueSlug(space.name, used);
      used.add(slug);
      const stored = savedById.get(space.id) ?? savedBySlug.get(slug);
      const detected = detections[space.id] ?? FALLBACK_SITE;
      const port = stored?.port ?? nextSitePort(taken);
      if (!stored) taken.push(port);
      return {
        id: space.id,
        slug,
        spaceName: space.name,
        root: space.root ?? "",
        docroot: stored?.docroot ?? detected.docroot,
        port,
        kind: detected.kind,
        env: space.env,
        confident: detected.confident,
        slowMount: IS_WINDOWS && space.env.kind !== "wsl",
      };
    });
  }, [config.sites, detections, spaces]);

  useEffect(() => {
    if (!preferencesHydrated || !spacesHydrated) return;
    const sites = siteRows.map(
      ({ id, slug, root, docroot, port, kind, env }) => ({
        id,
        slug,
        root,
        docroot,
        port,
        kind,
        env,
      }),
    );
    const unchanged =
      sites.length === config.sites.length &&
      sites.every((site, index) => {
        const current = config.sites[index];
        return (
          current?.id === site.id &&
          current.slug === site.slug &&
          current.root === site.root &&
          current.docroot === site.docroot &&
          current.port === site.port &&
          current.kind === site.kind &&
          sameEnv(current.env, site.env)
        );
      });
    if (!unchanged) void setServicesConfig({ ...config, sites });
  }, [config, preferencesHydrated, siteRows, spacesHydrated]);

  const setDocroot = useCallback(
    (id: string, docroot: string) => {
      const row = siteRows.find((site) => site.id === id);
      if (!row) return;
      const sites = config.sites.some((site) => site.id === id)
        ? config.sites.map((site) =>
            site.id === id ? { ...site, docroot } : site,
          )
        : [
            ...config.sites,
            {
              id,
              slug: row.slug,
              root: row.root,
              docroot,
              port: row.port,
              kind: row.kind,
              env: row.env,
            },
          ];
      void setServicesConfig({ ...config, sites });
    },
    [config, siteRows],
  );

  const openPreview = useCallback((url: string) => {
    void invoke("open_preview_tab", { url });
  }, []);

  const anyDb = config.services.some(
    (service) => service === "mariadb" || service === "postgres",
  );
  const webHealthy = ready && toRowStatus(statuses.nginx) === "healthy";

  const poll = useCallback(async () => {
    try {
      const rows = await invoke<ServiceStatus[]>("services_status", {
        runtime: config.runtime,
      });
      setStatuses(Object.fromEntries(rows.map((r) => [r.service, r])));
    } catch {
      // Runtime vanished mid-poll; keep the last known state.
    }
  }, [config.runtime]);

  useEffect(() => {
    if (!ready) return;
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [ready, poll]);

  const toggle = useCallback(
    async (id: ServiceId, next: boolean) => {
      let enabled = next
        ? Array.from(new Set([...config.services, id]))
        : config.services.filter((s) => s !== id);
      const targets: ServiceId[] = [id];
      if (
        !next &&
        enabled.includes("adminer") &&
        !enabled.some((s) => s === "mariadb" || s === "postgres")
      ) {
        enabled = enabled.filter((s) => s !== "adminer");
        targets.push("adminer");
      }
      const nextConfig: ServicesConfig = {
        ...config,
        services: enabled,
        dbPassword: config.dbPassword || generatePassword(),
      };
      const spec: StackSpec = {
        services: nextConfig.services,
        ports: nextConfig.ports,
        sites: nextConfig.sites,
        dbPassword: nextConfig.dbPassword,
      };
      await setServicesConfig(nextConfig);
      setBusyId(id);
      setError(null);
      try {
        await invoke(next ? "services_up" : "services_down", {
          runtime: config.runtime,
          spec,
          targets,
        });
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
        await invoke("services_delete_data", {
          runtime: config.runtime,
          volume,
        });
        await poll();
      } catch (e) {
        setError(String(e));
      }
    },
    [config.runtime, poll],
  );

  const bothReady =
    probes?.docker.state === "ready" && probes.podman.state === "ready";

  return (
    <div className="space-y-4">
      <RuntimeCard
        status={status}
        busy={probeBusy}
        error={probeError}
        onRefresh={() => void refreshRuntime()}
      />
      {bothReady && (
        <div className="flex items-center gap-1 rounded-md border p-1">
          {(
            [
              ["Auto", null],
              ["Docker", "docker"],
              ["Podman", "podman"],
            ] as const
          ).map(([label, value]) => (
            <button
              key={label}
              type="button"
              className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                config.runtime === value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/(--emph-medium) hover:text-foreground"
              }`}
              onClick={() =>
                void setServicesConfig({ ...config, runtime: value })
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}
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
                  disabled={id === "adminer" && !anyDb}
                  disabledReason={
                    id === "adminer" && !anyDb ? "Needs a database" : undefined
                  }
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
          <SitesTable
            rows={siteRows}
            webHealthy={webHealthy}
            onDocrootChange={setDocroot}
            onOpen={openPreview}
          />
        </div>
      )}
    </div>
  );
}
