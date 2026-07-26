export type PackageKind = "rpm" | "deb" | "unsupported";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface AssetPair {
  pkg: ReleaseAsset;
  sig: ReleaseAsset;
}

/** release.yml builds Linux for x86_64 only; anything else stays manual. */
const SUFFIX: Record<Exclude<PackageKind, "unsupported">, string> = {
  rpm: ".x86_64.rpm",
  deb: "_amd64.deb",
};

export function selectAsset(
  kind: PackageKind,
  assets: ReleaseAsset[],
): AssetPair | null {
  if (kind === "unsupported") return null;
  const suffix = SUFFIX[kind];
  const pkg = assets.find((a) => a.name.endsWith(suffix));
  if (!pkg) return null;
  const sig = assets.find((a) => a.name === `${pkg.name}.sig`);
  if (!sig) return null;
  return { pkg, sig };
}

function parseVersion(v: string): { parts: number[]; prerelease: boolean } {
  const cleaned = v.replace(/^v/, "");
  const [core, ...rest] = cleaned.split("-");
  return {
    parts: core.split(".").map((p) => Number.parseInt(p, 10) || 0),
    prerelease: rest.length > 0,
  };
}

/**
 * A prerelease sorts below its own release, so 0.9.0-beta1 never counts as
 * newer than 0.9.0. This gates an automatic root install, so an over-eager
 * comparison is worse than a conservative one.
 */
export function isNewer(remote: string, current: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  const len = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < len; i++) {
    const x = a.parts[i] ?? 0;
    const y = b.parts[i] ?? 0;
    if (x !== y) return x > y;
  }
  if (a.prerelease !== b.prerelease) return b.prerelease;
  return false;
}
