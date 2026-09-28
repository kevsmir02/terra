import type { GitDiffContentResult } from "@/lib/native";
import { invoke } from "@tauri-apps/api/core";

export type TurnFileStatus = "added" | "modified" | "deleted";

export type TurnChanges = {
  repoRoot: string;
  files: { path: string; status: TurnFileStatus }[];
  indexRestorable: boolean;
};

export type RevertOutcome = {
  restored: number;
  removed: number;
  indexRestored: number;
};

/** Loaded with the turn surfaces (the dialog and turn diff tabs), never at
 * startup. */
export const checkpointIpc = {
  changes: (repoRoot: string, id: string) =>
    invoke<TurnChanges>("git_checkpoint_changes", { repoRoot, id }),
  fileDiff: (repoRoot: string, id: string, path: string) =>
    invoke<GitDiffContentResult>("git_checkpoint_file_diff", {
      repoRoot,
      id,
      path,
    }),
  revert: (
    repoRoot: string,
    id: string,
    paths: string[],
    restoreIndex: boolean,
  ) =>
    invoke<RevertOutcome>("git_checkpoint_revert", {
      repoRoot,
      id,
      paths,
      restoreIndex,
    }),
};
