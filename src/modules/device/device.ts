import type { DeviceEntry } from "./generated/DeviceEntry";

export function deviceDisplayName(d: DeviceEntry): string {
  const model = d.model?.replace(/_/g, " ").trim();
  return model || d.serial;
}

// Readiness: whether a Device is usable. adb reports a usable device with the
// state string "device"; call this rather than compare against that literal.
export function isReady(d: DeviceEntry): boolean {
  return d.state === "device";
}
