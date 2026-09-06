import { cn } from "@/lib/utils";
import {
  AiPhone01Icon,
  CommandIcon,
  FolderGitTwoIcon,
  FolderTreeIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "./types";

const RAIL_WIDTH = 54;

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
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
};

const ITEM =
  "group relative flex w-[48px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-md outline-none transition-colors terra-motion focus-visible:ring-2 focus-visible:ring-primary/(--emph-soft)";
const ITEM_OFF =
  "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground";

export function SidebarRail({
  activeView,
  onSelectView,
  changedCount,
  onOpenCommandPalette,
  onOpenSettings,
}: Props) {
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
    <nav
      aria-label="Sidebar views"
      style={{ width: RAIL_WIDTH }}
      className="flex shrink-0 flex-col items-center gap-0.5 border-r border-border/(--emph-strong) bg-card/(--emph-bold) py-1.5 backdrop-blur"
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
              ITEM,
              "h-[46px] gap-1.5",
              isActive
                ? "bg-foreground/[0.07] text-foreground dark:bg-foreground/[0.09]"
                : ITEM_OFF,
            )}
          >
            <HugeiconsIcon
              icon={item.icon}
              size={17}
              strokeWidth={isActive ? 2 : 1.75}
              className="shrink-0 transition-[stroke-width] terra-motion"
            />
            <span className="terra-label text-[9px] font-medium leading-none">
              {item.label}
            </span>
            {badge !== null ? (
              <span className="absolute top-0.5 right-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-pill border border-border/(--emph-strong) bg-card px-1 text-[8.5px] font-semibold leading-none tabular-nums text-muted-foreground/(--emph-bold)">
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </button>
        );
      })}

      <span className="flex-1" />
      <span className="my-1 w-6 shrink-0 border-t border-border/(--emph-strong)" />

      <button
        type="button"
        aria-label="Command palette"
        title="Command palette"
        onClick={onOpenCommandPalette}
        className={cn(ITEM, "h-8", ITEM_OFF)}
      >
        <HugeiconsIcon icon={CommandIcon} size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        onClick={onOpenSettings}
        className={cn(ITEM, "h-8", ITEM_OFF)}
      >
        <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.75} />
      </button>
    </nav>
  );
}
