import { native } from "@/lib/native";
import { useCallback } from "react";
import { toast } from "sonner";
import { historyLookupDir } from "./fileHistory";

type OpenHistoryTab = (input: {
  repoRoot: string;
  path: string;
  directory: boolean;
}) => void;

/** Resolves the repository a path lives in and opens its filtered history. */
export function useFileHistoryOpener(openCommitHistoryTab: OpenHistoryTab) {
  return useCallback(
    async (path: string, directory = false) => {
      try {
        const repo = await native.gitResolveRepo(
          historyLookupDir(path, directory),
        );
        if (!repo) {
          toast.info("Not in a git repository", {
            id: "file-history-no-repo",
          });
          return;
        }
        openCommitHistoryTab({ repoRoot: repo.repoRoot, path, directory });
      } catch (e) {
        toast.error("Could not open history", { description: String(e) });
      }
    },
    [openCommitHistoryTab],
  );
}
