import { Button } from "@/components/ui/button";
import {
  ArrowLeft01Icon,
  Home01Icon,
  SquareIcon,
  VolumeHighIcon,
  VolumeLowIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Keycodes = {
  HOME: number;
  BACK: number;
  VOLUME_UP: number;
  VOLUME_DOWN: number;
  APP_SWITCH: number;
};

type Props = {
  keycodes: Keycodes;
  disabled?: boolean;
  onPress: (keycode: number) => void;
};

export function DeviceKeyBar({ keycodes, disabled, onPress }: Props) {
  const keys = [
    { label: "Back", icon: ArrowLeft01Icon, code: keycodes.BACK },
    { label: "Home", icon: Home01Icon, code: keycodes.HOME },
    { label: "Recents", icon: SquareIcon, code: keycodes.APP_SWITCH },
    { label: "Volume down", icon: VolumeLowIcon, code: keycodes.VOLUME_DOWN },
    { label: "Volume up", icon: VolumeHighIcon, code: keycodes.VOLUME_UP },
  ];

  return (
    <div className="flex h-9 shrink-0 items-center justify-center gap-0.5 border-t border-border/(--emph-strong) bg-card select-none">
      {keys.map((key) => (
        <Button
          key={key.label}
          onClick={() => onPress(key.code)}
          disabled={disabled}
          title={key.label}
          aria-label={key.label}
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={key.icon} size={16} strokeWidth={1.75} />
        </Button>
      ))}
    </div>
  );
}
