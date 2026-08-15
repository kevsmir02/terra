/** Kept dependency-free and tiny: this is the only services code allowed in
 * the eager bundle. Everything it gates is lazily imported. */
export function shouldMountPill(
  config: { services: string[] } | undefined,
): boolean {
  return (config?.services.length ?? 0) > 0;
}
