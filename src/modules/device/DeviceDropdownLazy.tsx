import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { DeviceDropdown as DeviceDropdownType } from "./DeviceDropdown";

const DeviceDropdownInner = lazy(() =>
  import("./DeviceDropdown").then((m) => ({ default: m.DeviceDropdown })),
);

type Props = ComponentProps<typeof DeviceDropdownType>;

export function DeviceDropdown(props: Props) {
  return (
    <Suspense fallback={null}>
      <DeviceDropdownInner {...props} />
    </Suspense>
  );
}
