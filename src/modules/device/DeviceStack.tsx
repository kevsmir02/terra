import { cn } from "@/lib/utils";
import type { DevicePreviewTab, Tab } from "@/modules/tabs";
import { DevicePreviewPane } from "./DevicePreviewPane";

type Props = { tabs: Tab[]; activeId: number };

export function DeviceStack({ tabs, activeId }: Props) {
  const panes = tabs.filter((t): t is DevicePreviewTab => t.kind === "device-preview" && !t.cold);
  if (panes.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {panes.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn("absolute inset-0", !visible && "invisible pointer-events-none")}
            aria-hidden={!visible}
          >
            <DevicePreviewPane tab={t} />
          </div>
        );
      })}
    </div>
  );
}
