/** Kept dependency-free and tiny: this is the only services code allowed in
 * the eager bundle. Everything it gates is lazily imported. */
export function shouldMountPill(
  config: { services: string[] } | undefined,
): boolean {
  return (config?.services.length ?? 0) > 0;
}

const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;

export type PollInput = {
  focused: boolean;
  servicesTabOpen: boolean;
  hasRunning: boolean;
};

/** `null` means do not poll at all. A mounted pill always polls while the
 * window is focused: gating the first poll on "something is running" is
 * circular, because only a poll can answer that, so the pill stayed invisible
 * for the whole session after a restart. Idle mounts just poll slower. */
export function pollIntervalMs({
  focused,
  servicesTabOpen,
  hasRunning,
}: PollInput): number | null {
  if (!focused) return null;
  return servicesTabOpen || hasRunning ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}
