import type { Text } from "@codemirror/state";

export type HunkAction = "stage" | "unstage" | "discard";

/** One change in the line model the backend re-reads and checks: 0-based
 * start lines and the exact lines on each side, without line endings. */
export type HunkLines = {
  oldFrom: number;
  oldLines: string[];
  newFrom: number;
  newLines: string[];
};

type ChunkSpan = { fromA: number; toA: number; fromB: number; toB: number };

function lineSpan(
  doc: Text,
  from: number,
  to: number,
): { from: number; lines: string[] } {
  if (to <= from) {
    return {
      from: from > doc.length ? doc.lines : doc.lineAt(from).number - 1,
      lines: [],
    };
  }
  const first = doc.lineAt(from).number;
  // `to` is one past the chunk's last line and may sit past the doc end.
  const last = doc.lineAt(Math.min(to - 1, doc.length)).number;
  const lines: string[] = [];
  for (let n = first; n <= last; n++) lines.push(doc.line(n).text);
  return { from: first - 1, lines };
}

export function chunkToHunk(a: Text, b: Text, chunk: ChunkSpan): HunkLines {
  const old = lineSpan(a, chunk.fromA, chunk.toA);
  const next = lineSpan(b, chunk.fromB, chunk.toB);
  return {
    oldFrom: old.from,
    oldLines: old.lines,
    newFrom: next.from,
    newLines: next.lines,
  };
}

/** The chunk the cursor is in, in document B. A deletion has no lines in B,
 * so it counts as current while the cursor sits at the line it removed from,
 * which is where stepping to it leaves the cursor. */
export function chunkAt(
  chunks: readonly { fromB: number; toB: number }[],
  pos: number,
): number {
  return chunks.findIndex((c) =>
    c.toB > c.fromB ? pos >= c.fromB && pos < c.toB : pos === c.fromB,
  );
}

/** What the selected change can do on this side of the diff. */
export function hunkActionsFor(mode: "-" | "+"): {
  primary: HunkAction;
  discard: boolean;
} {
  return mode === "-"
    ? { primary: "stage", discard: true }
    : { primary: "unstage", discard: false };
}
