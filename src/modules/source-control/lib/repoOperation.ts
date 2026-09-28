import { invoke } from "@tauri-apps/api/core";
import type { GitRepoOperation } from "@/lib/native";

const LABELS: Record<GitRepoOperation, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  am: "Patch apply",
};

export type OperationBannerView = {
  title: string;
  detail: string;
  /** Why Continue is off, or null when it can run. */
  continueBlocked: string | null;
};

export function operationBanner(
  operation: GitRepoOperation,
  conflictCount: number,
): OperationBannerView {
  const title = `${LABELS[operation]} in progress`;
  if (conflictCount > 0) {
    const noun = conflictCount === 1 ? "conflict" : "conflicts";
    return {
      title,
      detail: `${conflictCount} ${noun} to resolve`,
      continueBlocked: "Mark every conflicted file resolved first.",
    };
  }
  return { title, detail: "all conflicts resolved", continueBlocked: null };
}

// The backend re-reads the repo state and refuses when it no longer matches
// `operation`, so a stale banner can never abort the wrong thing.
export const repoOperation = {
  abort: (repoRoot: string, operation: GitRepoOperation) =>
    invoke<void>("git_operation_abort", { repoRoot, operation }),
  continue: (repoRoot: string, operation: GitRepoOperation) =>
    invoke<void>("git_operation_continue", { repoRoot, operation }),
  markResolved: (repoRoot: string, path: string) =>
    invoke<void>("git_mark_resolved", { repoRoot, path }),
};
