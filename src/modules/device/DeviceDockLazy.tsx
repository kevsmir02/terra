import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { DeviceDock as DeviceDockType } from "./DeviceDock";
import type { DeviceEntry } from "./generated/DeviceEntry";

const DeviceDockInner = lazy(() =>
  import("./DeviceDock").then((m) => ({ default: m.DeviceDock })),
);

type Props = Omit<ComponentProps<typeof DeviceDockType>, "device"> & {
  device: DeviceEntry | null;
};

/**
 * The no-device guard lives here, not in DeviceDock. React only requests a lazy
 * chunk once the inner element renders, so returning early is what keeps the
 * MSE player and control bridge out of the startup graph until a device is
 * actually picked. Moving this guard inward would load them at first paint.
 */
export function DeviceDock({ device, ...rest }: Props) {
  if (!device) return null;

  return (
    <Suspense fallback={null}>
      <DeviceDockInner device={device} {...rest} />
    </Suspense>
  );
}
