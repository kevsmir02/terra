export const DEFAULT_WATCH: string[];
export function traceEager(
  entry: string,
  watch?: string[],
): {
  moduleCount: number;
  hits: Map<string, { spec: string; file: string }>;
  /** Every local module reached, relative to the repo root. */
  files: string[];
};
