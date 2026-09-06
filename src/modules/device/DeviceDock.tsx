import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { deviceDisplayName } from "./device";
import { DevicePreviewPane } from "./DevicePreviewPane";
import type { DeviceEntry } from "./generated/DeviceEntry";

type Props = {
  device: DeviceEntry;
  onStop: () => void;
};

/**
 * Right-docked device surface. Only ever mounted with a picked device
 * (DeviceDockLazy holds the no-device guard); the panel itself stays collapsed
 * at zero width until then, so there is no empty state to design.
 *
 * `overflow-hidden` matters: react-resizable-panels sets `overflow: visible`
 * on the panel element, so without it the video would spill over the workspace
 * while the dock is collapsed to zero width.
 */
export function DeviceDock({ device, onStop }: Props) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border/(--emph-strong) bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/(--emph-strong) px-2">
        <div className="flex min-w-0 flex-col justify-center">
          <span
            className="truncate text-[11px] font-medium text-foreground"
            title={device.serial}
          >
            {deviceDisplayName(device)}
          </span>
          {device.model && (
            <span className="truncate text-[10px] text-muted-foreground">
              {device.serial}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onStop}
          title="Stop and close this device"
          aria-label="Stop and close this device"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {/* Keyed on serial so switching devices mounts a fresh pane instead
            of reusing one that may be stuck in another device's error state. */}
        <DevicePreviewPane key={device.serial} device={device} />
      </div>
    </div>
  );
}
