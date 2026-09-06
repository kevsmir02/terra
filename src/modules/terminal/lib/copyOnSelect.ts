/** Pointer travel, in CSS pixels, that separates a click from a drag. Carried
 *  over from the original mouse-up handler so click behaviour is unchanged. */
export const DRAG_THRESHOLD_PX = 4;

export type Point = { x: number; y: number };

/**
 * True when the pointer moved far enough to count as a drag-selection.
 *
 * Each axis is judged on its own rather than by diagonal distance: the handler
 * this replaces compared only `clientY`, which classified a selection inside a
 * single line, a filename, a hash, a URL, as a click. A null origin means no
 * matching mousedown was seen, which is never a drag.
 */
export function isDragGesture(
  from: Point | null,
  to: Point,
  threshold: number = DRAG_THRESHOLD_PX,
): boolean {
  if (from === null) return false;
  return (
    Math.abs(to.x - from.x) > threshold || Math.abs(to.y - from.y) > threshold
  );
}

/**
 * The text worth putting on the clipboard, or null when the selection carries
 * no content. Content is returned unchanged, leading indentation is frequently
 * what the user is selecting, but a selection of only whitespace is dropped,
 * since dragging across blank rows picks up row padding and would otherwise
 * silently replace the clipboard with spaces.
 */
export function selectionToCopy(raw: string): string | null {
  return raw.trim().length === 0 ? null : raw;
}
