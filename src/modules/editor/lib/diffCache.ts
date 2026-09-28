import type { GitDiffContentResult } from "@/lib/native";
import { gitIpc } from "@/modules/source-control/lib/gitIpc";

const DIFF_CACHE_LIMIT = 6;
const inflight = new Map<string, Promise<GitDiffContentResult>>();
const cache = new Map<string, GitDiffContentResult>();
// Bumped on every invalidation of a repo, so a fetch that started before the
// bump can neither land in the cache nor be joined by a fetch started after.
const generations = new Map<string, number>();
const listeners = new Set<(repoRoot: string) => void>();

function touch(key: string, value: GitDiffContentResult) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > DIFF_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function repoOfKey(key: string): string {
  return key.slice(0, key.indexOf("|"));
}

function bump(repoRoot: string): void {
  generations.set(repoRoot, (generations.get(repoRoot) ?? 0) + 1);
  for (const listener of [...listeners]) listener(repoRoot);
}

export function diffGeneration(repoRoot: string): number {
  return generations.get(repoRoot) ?? 0;
}

/** Called with the repo root whenever its diffs are invalidated, so an open
 * pane can refetch instead of showing what the cache used to hold. */
export function subscribeDiffInvalidation(
  listener: (repoRoot: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedDiff(key: string): GitDiffContentResult | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function invalidateDiff(key: string): void {
  cache.delete(key);
  bump(repoOfKey(key));
}

export function invalidateRepoDiffs(repoRoot: string): void {
  const prefix = `${repoRoot}|`;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
  bump(repoRoot);
}

export function workingDiffKey(
  repoRoot: string,
  path: string,
  mode: "-" | "+",
): string {
  return `${repoRoot}|w|${mode}|${path}`;
}

export function commitDiffKey(
  repoRoot: string,
  sha: string,
  path: string,
): string {
  return `${repoRoot}|c|${sha}|${path}`;
}

function cachedFetch(
  repoRoot: string,
  key: string,
  force: boolean,
  load: () => Promise<GitDiffContentResult>,
): Promise<GitDiffContentResult> {
  if (!force) {
    const cached = getCachedDiff(key);
    if (cached) return Promise.resolve(cached);
  }
  const gen = diffGeneration(repoRoot);
  const flightKey = `${gen}#${key}`;
  const pending = inflight.get(flightKey);
  if (pending) return pending;
  const p = load()
    .then((res) => {
      if (diffGeneration(repoRoot) === gen) touch(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(flightKey);
    });
  inflight.set(flightKey, p);
  return p;
}

/** `force` skips the cache read (a revalidation) but still joins a fetch of
 * the same generation already in flight. */
export function fetchWorkingDiff(
  repoRoot: string,
  path: string,
  mode: "-" | "+",
  originalPath: string | null,
  force = false,
): Promise<GitDiffContentResult> {
  return cachedFetch(
    repoRoot,
    workingDiffKey(repoRoot, path, mode),
    force,
    () => gitIpc.gitDiffContent(repoRoot, path, mode === "+", originalPath),
  );
}

export function fetchCommitDiff(
  repoRoot: string,
  sha: string,
  path: string,
  originalPath: string | null,
): Promise<GitDiffContentResult> {
  return cachedFetch(repoRoot, commitDiffKey(repoRoot, sha, path), false, () =>
    gitIpc.gitCommitFileDiff(repoRoot, sha, path, originalPath),
  );
}

export function sameDiff(
  a: GitDiffContentResult,
  b: GitDiffContentResult,
): boolean {
  return (
    a.originalContent === b.originalContent &&
    a.modifiedContent === b.modifiedContent &&
    a.fallbackPatch === b.fallbackPatch &&
    a.isBinary === b.isBinary &&
    a.tooLarge === b.tooLarge &&
    a.truncated === b.truncated &&
    a.conflict === b.conflict
  );
}
