import type {
  GitBlame,
  GitBranchListResult,
  GitCommitFileChange,
  GitCommitResult,
  GitDiffContentResult,
  GitDiscardEntry,
  GitLogEntry,
  GitStashEntry,
} from "@/lib/native";
import { invoke } from "@tauri-apps/api/core";

/** The git commands only the lazy review surfaces call (source control,
 * history, diffs). They live here rather than on `native` so they load with
 * those surfaces instead of at startup. */
export const gitIpc = {
  gitDiffContent: (
    repoRoot: string,
    path: string,
    staged: boolean,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_diff_content", {
      repoRoot,
      path,
      staged,
      originalPath: originalPath ?? null,
    }),
  gitStage: (repoRoot: string, paths: string[]) =>
    invoke<void>("git_stage", {
      repoRoot,
      paths,
    }),
  gitUnstage: (repoRoot: string, paths: string[]) =>
    invoke<void>("git_unstage", {
      repoRoot,
      paths,
    }),
  gitDiscard: (repoRoot: string, entries: GitDiscardEntry[]) =>
    invoke<void>("git_discard", {
      repoRoot,
      entries,
    }),
  gitCommit: (repoRoot: string, message: string) =>
    invoke<GitCommitResult>("git_commit", {
      repoRoot,
      message,
    }),
  /** Pages by `skip` from `anchorSha`, the first page's head, so a merge or
   * a commit made between pages can neither skip nor repeat a row. With
   * `path` the anchor must be the head, not the first row: the newest commit
   * touching a file can sit on a merged side branch. */
  gitLog: (
    repoRoot: string,
    options?: {
      limit?: number;
      skip?: number;
      anchorSha?: string;
      path?: string;
    },
  ) =>
    invoke<GitLogEntry[]>("git_log", {
      repoRoot,
      limit: options?.limit ?? null,
      skip: options?.skip ?? null,
      anchorSha: options?.anchorSha ?? null,
      path: options?.path ?? null,
    }),
  gitBlame: (path: string) => invoke<GitBlame>("git_blame", { path }),
  gitCommitFiles: (repoRoot: string, sha: string) =>
    invoke<GitCommitFileChange[]>("git_commit_files", {
      repoRoot,
      sha,
    }),
  gitCommitFileDiff: (
    repoRoot: string,
    sha: string,
    path: string,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_commit_file_diff", {
      repoRoot,
      sha,
      path,
      originalPath: originalPath ?? null,
    }),
  gitRemoteUrl: (repoRoot: string, name?: string) =>
    invoke<string | null>("git_remote_url", {
      repoRoot,
      name: name ?? null,
    }),
  gitListBranches: (repoRoot: string) =>
    invoke<GitBranchListResult>("git_list_branches", {
      repoRoot,
    }),
  gitCheckoutBranch: (repoRoot: string, branch: string) =>
    invoke<void>("git_checkout_branch", {
      repoRoot,
      branch,
    }),
  gitCommitAmend: (repoRoot: string, message: string) =>
    invoke<GitCommitResult>("git_commit_amend", {
      repoRoot,
      message,
    }),
  gitStashPush: (repoRoot: string, message: string) =>
    invoke<boolean>("git_stash_push", {
      repoRoot,
      message,
    }),
  gitStashPop: (repoRoot: string) =>
    invoke<void>("git_stash_pop", {
      repoRoot,
    }),
  gitStashList: (repoRoot: string) =>
    invoke<GitStashEntry[]>("git_stash_list", {
      repoRoot,
    }),
  gitCreateBranch: (repoRoot: string, name: string) =>
    invoke<void>("git_create_branch", {
      repoRoot,
      name,
    }),
};
