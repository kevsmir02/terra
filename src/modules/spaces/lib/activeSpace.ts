import type { SpaceMeta } from "./store";

export function findActiveSpace(
  spaces: SpaceMeta[],
  activeId: string | null,
): SpaceMeta | null {
  if (activeId) {
    const found = spaces.find((s) => s.id === activeId);
    if (found) return found;
  }
  return spaces[0] ?? null;
}

export function freshTabCwd(
  restoredHome: string | null,
  launchCwd: string | null,
  home: string | null,
): string | null {
  return restoredHome ?? launchCwd ?? home;
}
