import { useBlockController } from "@/modules/terminal/lib/blockController";
import { lazy, Suspense } from "react";

const ShellInput = lazy(() => import("@/modules/terminal/block/ShellInput"));

export const TOGGLE_BLOCK_INPUT_EVENT = "terra:toggle-block-input";

type Props = {
  isBlockTab: boolean;
  isTerminalTab: boolean;
  activeLeafId: number | null;
  cwd: string | null;
  home: string | null;
};

export function WorkspaceInputBar({ isBlockTab, activeLeafId }: Props) {
  const controller = useBlockController(isBlockTab ? activeLeafId : null);
  const blockMode = controller?.blockMode ?? "prompt";

  if (!isBlockTab) return null;

  return (
    <div data-ai-input-bar data-state="open" className="terra-reveal">
      <div className="shrink-0 border-t border-border/(--emph-strong) bg-card/(--emph-soft) px-3 py-2">
        <div className="flex flex-col gap-2 rounded-lg px-1 py-1">
          {controller && activeLeafId != null && (
            <Suspense fallback={null}>
              <ShellInput
                leafId={activeLeafId}
                mode={blockMode}
                focused
                onSubmit={controller.submitCommand}
                onInterrupt={controller.interrupt}
                getCwd={controller.getCwd}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
