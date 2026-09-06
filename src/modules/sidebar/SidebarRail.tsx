import { cn } from "@/lib/utils";
import { AiPhone01Icon, FolderGitTwoIcon, FolderTreeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "./types";

export const SIDEBAR_RAIL_HEIGHT = 36;

type RailItem = {
  id: SidebarViewId;
  label: string;
  // Full name for the accessible label and tooltip; `label` is what fits the
  // rail, which is only wide enough for one short word per item.
  title: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  badge?: number;
};

type Props = {
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
};

export function SidebarRail({ activeView, onSelectView, changedCount }: Props) {
  const items: RailItem[] = [
    { id: "explorer", label: "Files", title: "Files", icon: FolderTreeIcon },
    {
      id: "source-control",
      label: "Source",
      title: "Source Control",
      icon: FolderGitTwoIcon,
      badge: changedCount,
    },
    {
      id: "devices",
      label: "Devices",
      title: "Devices",
      icon: AiPhone01Icon,
    },
  ];

  return (
    <div
      style={{ height: SIDEBAR_RAIL_HEIGHT }}
      className="flex shrink-0 items-stretch gap-1 border-t border-border/(--emph-strong) bg-card/(--emph-bold) px-1.5 py-1 backdrop-blur"
    >
      {items.map((item) => {
        const isActive = item.id === activeView;
        const badge = item.badge && item.badge > 0 ? item.badge : null;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.title}
            title={item.title}
            aria-pressed={isActive}
            onClick={() => onSelectView(item.id)}
            className={cn(
              "group relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-1 text-[11px] font-medium outline-none transition-colors duration-[var(--dur-base)]",
              "focus-visible:ring-2 focus-visible:ring-primary/(--emph-soft)",
              isActive
                ? "bg-foreground/[0.07] text-foreground dark:bg-foreground/[0.09]"
                : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
            )}
          >
            <HugeiconsIcon
              icon={item.icon}
              size={14}
              strokeWidth={isActive ? 2 : 1.75}
              className="shrink-0 transition-[stroke-width] duration-[var(--dur-base)]"
            />
            <span className="truncate">{item.label}</span>
            {badge !== null ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-pill border border-border/(--emph-strong) bg-card px-1 text-[9px] font-semibold leading-none tabular-nums text-muted-foreground/(--emph-bold)">
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
