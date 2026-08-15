import { IS_WINDOWS } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setServicesConfig } from "@/modules/settings/store";
import { loadAll } from "@/modules/spaces/lib/store";
import { useSpaces } from "@/modules/spaces";
import {
  generatePassword,
  LogsDrawer,
  nextSitePort,
  RuntimeCard,
  SERVICE_META,
  ServiceRow,
  SitesTable,
  uniqueSlug,
  type RowStatus,
  type RuntimeStatus,
  type ServiceId,
  type ServicesConfig,
  type SiteRow,
  VOLUME_BY_ID,
} from "@/modules/services";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";

type ServiceStatus = { service: string; state: string; health: string | null };

type DetectedSite = {
  kind: "php" | "static";
  docroot: string;
  confident: boolean;
};

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

export function ServicesSection() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const [busyId, setBusyId] = useState<ServiceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = status?.state === "ready";
  const config = usePreferencesStore((s) => s.services);
  const preferencesHydrated = usePreferencesStore((s) => s.hydrated);
  const spaces = useSpaces((s) => s.spaces);
  const spacesHydrated = useSpaces((s) => s.hydrated);
  const [detections, setDetections] = useState<Record<string, DetectedSite>>(
    {},
  );

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
            await invoke<DetectedSite>("sites_detect", { root }),
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
    const saved = new Map(config.sites.map((site) => [site.slug, site]));
    const taken = config.sites.map((site) => site.port);
    const used = new Set<string>();
    return spaces.map((space) => {
      const slug = uniqueSlug(space.name, used);
      used.add(slug);
      const stored = saved.get(slug);
      const detected = detections[space.id] ?? FALLBACK_SITE;
      const port = stored?.port ?? nextSitePort(taken);
      if (!stored) taken.push(port);
      return {
        slug,
        spaceName: space.name,
        root: space.root ?? "",
        docroot: stored?.docroot ?? detected.docroot,
        port,
        kind: detected.kind,
        confident: detected.confident,
        slowMount: IS_WINDOWS && space.env.kind !== "wsl",
      };
    });
  }, [config.sites, detections, spaces]);

  useEffect(() => {
    if (!preferencesHydrated || !spacesHydrated) return;
    const sites = siteRows.map(({ slug, root, docroot, port, kind }) => ({
      slug,
      root,
      docroot,
      port,
      kind,
    }));
    const unchanged =
      sites.length === config.sites.length &&
      sites.every((site, index) => {
        const current = config.sites[index];
        return (
          current?.slug === site.slug &&
          current.root === site.root &&
          current.docroot === site.docroot &&
          current.port === site.port &&
          current.kind === site.kind
        );
      });
    if (!unchanged) void setServicesConfig({ ...config, sites });
  }, [config, preferencesHydrated, siteRows, spacesHydrated]);

  const setDocroot = useCallback(
    (slug: string, docroot: string) => {
      const row = siteRows.find((site) => site.slug === slug);
      if (!row) return;
      const sites = config.sites.some((site) => site.slug === slug)
        ? config.sites.map((site) =>
            site.slug === slug ? { ...site, docroot } : site,
          )
        : [
            ...config.sites,
            { slug, root: row.root, docroot, port: row.port, kind: row.kind },
          ];
      void setServicesConfig({ ...config, sites });
    },
    [config, siteRows],
  );

  const openPreview = useCallback((url: string) => {
    void invoke("open_preview_tab", { url });
  }, []);

  const webHealthy = ready && toRowStatus(statuses.nginx) === "healthy";

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
