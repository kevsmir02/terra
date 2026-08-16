const RESERVED = new Set([1025, 3306, 5432, 6379, 8025, 8026]);

export type SiteKind = "php" | "static";

/** Only a confident detection may change a saved kind. `sites_detect` falls
 * back to an unconfident "static" whenever it cannot read the directory, so
 * letting detection always win silently downgraded a PHP site and persisted
 * it, after which nginx stopped serving the site's index.php. */
export function resolveSiteKind(
  stored: SiteKind | undefined,
  detected: { kind: SiteKind; confident: boolean },
): SiteKind {
  if (detected.confident) return detected.kind;
  return stored ?? detected.kind;
}

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

export function nextSitePort(taken: number[]): number {
  const used = new Set(taken);
  let port = 8000;
  while (used.has(port) || RESERVED.has(port)) port++;
  return port;
}

export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugFromName(name) || "site";
  if (!taken.has(base)) return base;
  let i = 2;
  while (true) {
    const suffix = `-${i}`;
    const head = base.slice(0, 63 - suffix.length).replace(/-+$/, "");
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate)) return candidate;
    i++;
  }
}
