import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export type GitStatusChipProps = {
  hasRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  changedCount: number;
};

/**
 * Mirrors the branch the source-control panel already resolved. Read-only on
 * purpose: the statusbar answers "where am I", the panel owns every action.
 */
export function GitStatusChip({
  hasRepo,
  branch,
  ahead,
  behind,
  changedCount,
}: GitStatusChipProps) {
  if (!hasRepo || !branch) return null;

  const detail = [
    ahead > 0 ? `${ahead} ahead` : null,
    behind > 0 ? `${behind} behind` : null,
    changedCount > 0
      ? `${changedCount} changed ${changedCount === 1 ? "file" : "files"}`
      : "clean",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="terra-label terra-pill-in flex h-4.5 min-w-0 shrink-0 cursor-default items-center gap-1.5 rounded-sm bg-foreground/[0.05] px-1.5 text-[10.5px] font-medium text-muted-foreground">
          <HugeiconsIcon
            icon={GitBranchIcon}
            size={11}
            strokeWidth={2}
            className="shrink-0"
          />
          <span className="max-w-32 truncate text-foreground/(--emph-bold)">
            {branch}
          </span>
          {ahead > 0 ? (
            <span className="shrink-0 tabular-nums">{`↑${ahead}`}</span>
          ) : null}
          {behind > 0 ? (
            <span className="shrink-0 tabular-nums">{`↓${behind}`}</span>
          ) : null}
          {changedCount > 0 ? (
            <span className="shrink-0 tabular-nums text-status-modified">
              {changedCount > 99 ? "99+" : changedCount}
            </span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        {branch}
        {detail ? ` · ${detail}` : null}
      </TooltipContent>
    </Tooltip>
  );
}
