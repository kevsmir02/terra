import type { DeviceEntry } from "./generated/DeviceEntry";

export function deviceDisplayName(d: DeviceEntry): string {
  const model = d.model?.replace(/_/g, " ").trim();
  return model || d.serial;
}
