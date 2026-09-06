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

/**
 * Default AVD name for a system image Terra just installed, so the auto-create
 * after an install needs no prompt. Kept to the characters `is_safe_avd_name`
 * accepts, since the Rust side refuses anything else.
 */
export function avdNameForImage(pkg: string): string {
  const api = pkg.split(";")[1]?.replace(/^android-/, "") ?? "";
  const suffix = api.replace(/[^A-Za-z0-9]/g, "");
  return suffix ? `Terra_Android_${suffix}` : "Terra_Android";
}
