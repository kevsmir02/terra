import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LspStatusPill } from "@/modules/lsp";
import { IncognitoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { DiagnosticsBadge } from "./DiagnosticsBadge";
import { GitStatusChip, type GitStatusChipProps } from "./GitStatusChip";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  privateActive: boolean;
  git: GitStatusChipProps;
  /** Agent cluster, injected so the statusbar keeps no dependency on agents. */
  agents: ReactNode;
};

/**
 * Two zones: the left says where you are (path, branch), the right says what
 * state things are in (agents, language server, diagnostics). Everything used
 * to crowd the left with two thirds of the bar empty.
 */
export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  privateActive,
  git,
  agents,
}: Props) {
  return (
    <footer className="terra-chrome flex h-6.5 shrink-0 items-center gap-2 border-t border-border/(--emph-strong) bg-card/(--emph-strong) px-2 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        <GitStatusChip {...git} />
      </div>

      <div className="min-w-4 flex-1" />

      <div className="flex shrink-0 items-center gap-1.5">
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="terra-label flex h-4.5 shrink-0 cursor-default items-center gap-1 rounded-sm bg-status-warning/15 px-1.5 text-[10.5px] font-medium text-status-warning">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-64 text-[11px] leading-relaxed"
            >
              AI can't see this terminal's output. Use it for secrets, SSH, or
              anything you don't want sent to the model.
            </TooltipContent>
          </Tooltip>
        ) : null}
        {agents}
        <LspStatusPill filePath={filePath ?? null} />
        <DiagnosticsBadge filePath={filePath ?? null} />
      </div>
    </footer>
  );
}
