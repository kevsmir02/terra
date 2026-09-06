export const PERSIST_SCROLLBACK_LINES = 1000;
export const PERSIST_MAX_BYTES = 128 * 1024;
const SGR_RESET = "\x1b[0m";

// Keeps the tail of a serialized buffer under the byte cap, cutting at a line
// boundary when one is near and resetting attributes so a mid-run cut cannot
// leak styling into the restored screen.
export function capScrollback(text: string, maxBytes: number): string | null {
  const trimmed = text.replace(/(\r?\n)+$/, "");
  if (!trimmed.trim()) return null;
  if (trimmed.length <= maxBytes) return trimmed;
  const from = trimmed.length - maxBytes;
  const boundary = trimmed.indexOf("\n", from);
  const start =
    boundary === -1 || boundary - from > maxBytes / 4 ? from : boundary + 1;
  return SGR_RESET + trimmed.slice(start);
}

// Buffers restored from disk wait here until the leaf's session is created;
// a leaf that is never opened keeps its text so the next exit persists it.
const restored = new Map<number, string>();

export function stashRestoredScrollback(leafId: number, text: string): void {
  restored.set(leafId, text);
}

export function takeRestoredScrollback(leafId: number): string | null {
  const text = restored.get(leafId) ?? null;
  restored.delete(leafId);
  return text;
}

export function peekRestoredScrollback(leafId: number): string | null {
  return restored.get(leafId) ?? null;
}
