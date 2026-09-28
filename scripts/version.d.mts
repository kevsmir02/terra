export function isSemver(v: unknown): boolean;

export function readVersions(texts: Record<string, string>): Record<string, string>;

export function checkVersions(
  versions: Record<string, string>,
  tag?: string,
): string[];

export function bumpVersions(
  texts: Record<string, string>,
  version: string,
): Record<string, string>;
