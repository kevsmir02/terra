import { shortcutLabel } from "@/modules/shortcuts";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { displayAgent } from "../lib/format";
import { acceptResume } from "../lib/resumeOffer";
import { useResumeStore } from "../store/resumeStore";

/** Offers to resume the agent this pane ran before the last close. Never runs
 * on its own: the command is typed only on a click or `agent.resume`. */
export function ResumeAgentChip({ leafId }: { leafId: number }) {
  const agent = useResumeStore((s) => s.offers[leafId]);
  const dismiss = useResumeStore((s) => s.dismiss);
  if (!agent) return null;
  const name = displayAgent(agent);
  const hint = shortcutLabel("agent.resume");
  return (
    <div className="terra-pop-in absolute top-3 right-3 z-10 flex items-center gap-1 rounded-pill border border-border/(--emph-strong) bg-background/(--emph-bold) py-1 pr-1 pl-2.5 text-xs shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => acceptResume(leafId)}
        title={hint ? `Resume ${name} (${hint})` : undefined}
        className="terra-label font-medium text-foreground"
      >
        Resume {name}
      </button>
      <button
        type="button"
        onClick={() => dismiss(leafId)}
        aria-label={`Dismiss resuming ${name}`}
        className="grid size-5 place-items-center rounded-pill text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
      </button>
    </div>
  );
}
