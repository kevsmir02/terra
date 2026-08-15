const RESERVED = new Set([1025, 3306, 5432, 6379, 8025, 8026]);

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

export function uniqueSlug(
  name: string,
  taken: ReadonlySet<string>,
): string {
  const base = slugFromName(name) || "site";
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
