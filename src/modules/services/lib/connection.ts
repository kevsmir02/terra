export type ServiceId =
  | "mariadb"
  | "postgres"
  | "redis"
  | "mailpit"
  | "adminer"
  | "web";

export type ConnectionDetails = {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  database: string | null;
  dsn: string;
};

export function connectionDetails(
  id: ServiceId,
  port: number,
  password: string,
): ConnectionDetails | null {
  switch (id) {
    case "mariadb":
      return {
        host: "127.0.0.1",
        port,
        user: "root",
        password,
        database: "terra",
        dsn: connectionString(id, port, password) ?? "",
      };
    case "postgres":
      return {
        host: "127.0.0.1",
        port,
        user: "terra",
        password,
        database: "terra",
        dsn: connectionString(id, port, password) ?? "",
      };
    case "redis":
      return {
        host: "127.0.0.1",
        port,
        user: null,
        password: null,
        database: null,
        dsn: connectionString(id, port, password) ?? "",
      };
    default:
      return null;
  }
}

export function connectionString(
  id: ServiceId,
  port: number,
  password: string,
): string | null {
  switch (id) {
    case "mariadb":
      return `mysql://root:${password}@127.0.0.1:${port}/terra`;
    case "postgres":
      return `postgresql://terra:${password}@127.0.0.1:${port}/terra`;
    case "redis":
      return `redis://127.0.0.1:${port}`;
    default:
      return null;
  }
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** The alphabet is constrained so the password can never need YAML escaping
 * when it is written into the generated compose file. */
export function generatePassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
