export type ServiceId =
  | "mariadb"
  | "postgres"
  | "redis"
  | "mailpit"
  | "adminer"
  | "web";

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
