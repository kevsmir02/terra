import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { DeviceDock as DeviceDockType } from "./DeviceDock";

const DeviceDockInner = lazy(() =>
  import("./DeviceDock").then((m) => ({ default: m.DeviceDock })),
);

type Props = Omit<ComponentProps<typeof DeviceDockType>, "serial"> & {
  serial: string | null;
};

/**
 * The no-device guard lives here, not in DeviceDock. React only requests a lazy
 * chunk once the inner element renders, so returning early is what keeps the
 * MSE player and control bridge out of the startup graph until a device is
 * actually picked. Moving this guard inward would load them at first paint.
 */
export function DeviceDock({ serial, ...rest }: Props) {
  if (!serial) return null;

  return (
    <Suspense fallback={null}>
      <DeviceDockInner serial={serial} {...rest} />
    </Suspense>
  );
}
