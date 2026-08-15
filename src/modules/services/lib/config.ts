import type { WorkspaceEnv } from "@/modules/workspace";
import type { ServiceId } from "@/modules/services/lib/connection";

export type ServicesConfig = {
  services: string[];
  ports: Record<string, number>;
  sites: {
    id: string;
    slug: string;
    root: string;
    docroot: string;
    port: number;
    kind: "php" | "static";
    env: WorkspaceEnv;
  }[];
  dbPassword: string;
  runtime: "docker" | "podman" | null;
};

export type ServiceMeta = {
  label: string;
  defaultPort: number;
  /** Compose service name: the web tier renders as "nginx", not "web". */
  composeName: string;
};

/** Defaults mirror the Rust catalog in src-tauri/src/modules/services/catalog.rs.
 * Mailpit's SMTP side (1025) is fixed and web ports come from the site list. */
export const SERVICE_META: Record<ServiceId, ServiceMeta> = {
  mariadb: { label: "MariaDB", defaultPort: 3306, composeName: "mariadb" },
  postgres: { label: "PostgreSQL", defaultPort: 5432, composeName: "postgres" },
  redis: { label: "Redis", defaultPort: 6379, composeName: "redis" },
  mailpit: { label: "Mailpit", defaultPort: 8025, composeName: "mailpit" },
  adminer: { label: "Adminer", defaultPort: 8026, composeName: "adminer" },
  web: { label: "Web", defaultPort: 8000, composeName: "nginx" },
};

/** Only the databases own a named volume; every other service has nothing to delete. */
export const VOLUME_BY_ID: Partial<Record<ServiceId, string>> = {
  mariadb: "terra_mariadb_data",
  postgres: "terra_postgres_data",
};
