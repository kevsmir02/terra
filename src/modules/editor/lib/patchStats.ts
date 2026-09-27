export type PatchStats = { added: number; removed: number };

type Hunk = { parents: number[]; result: number };

const HUNK_HEADER = /^(@{2,}) ((?:[-+]\d+(?:,\d+)? )+)\1/;

function rangeCount(range: string): number {
  const comma = range.indexOf(",");
  return comma === -1 ? 1 : Number(range.slice(comma + 1));
}

/** Reads `@@ -a,b +c,d @@` and the combined `@@@ -a,b -c,d +e,f @@@` form a
 * conflicted path produces: one old range per parent, then the result. */
function parseHunkHeader(line: string): Hunk | null {
  const match = HUNK_HEADER.exec(line);
  if (!match) return null;
  const ranges = match[2].trim().split(" ");
  const parentCount = match[1].length - 1;
  if (ranges.length !== parentCount + 1) return null;
  const counts = ranges.map(rangeCount);
  if (counts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { parents: counts.slice(0, parentCount), result: counts[parentCount] };
}

function exhausted(hunk: Hunk): boolean {
  return hunk.result === 0 && hunk.parents.every((n) => n === 0);
}

/** Counts added and removed lines inside hunks only, consuming each hunk by
 * the line counts its header declares. A removed `- bullet` or `--flag`
 * reads as `-- bullet` / `---flag`, and file headers read as `--- a/x`, so
 * any rule keyed on leading characters alone miscounts one or the other. */
export function patchStats(patch: string): PatchStats {
  let added = 0;
  let removed = 0;
  let hunk: Hunk | null = null;
  for (const line of patch.split("\n")) {
    if (hunk === null) {
      if (line.startsWith("@@")) hunk = parseHunkHeader(line);
      continue;
    }
    if (line.startsWith("\\")) continue;
    const width = hunk.parents.length;
    // A blank context line whose leading space was stripped in transit.
    const prefix = line === "" ? " ".repeat(width) : line.slice(0, width);
    if (prefix.length < width || /[^ +-]/.test(prefix)) {
      hunk = line.startsWith("@@") ? parseHunkHeader(line) : null;
      continue;
    }
    const gone = prefix.includes("-");
    for (let i = 0; i < width; i++) {
      if (prefix[i] !== "+") hunk.parents[i] = Math.max(0, hunk.parents[i] - 1);
    }
    if (gone) removed++;
    else {
      hunk.result = Math.max(0, hunk.result - 1);
      if (prefix.includes("+")) added++;
    }
    if (exhausted(hunk)) hunk = null;
  }
  return { added, removed };
}
