// Prompt markers (OSC 133 A) give every command a buffer line; a marker that
// scrolled out of the buffer reports a negative line and is ignored.
export function stepCommandLine(
  lines: number[],
  viewportTop: number,
  delta: 1 | -1,
): number | null {
  const valid = lines.filter((line) => line >= 0);
  const candidates =
    delta < 0
      ? valid.filter((line) => line < viewportTop)
      : valid.filter((line) => line > viewportTop);
  if (candidates.length === 0) return null;
  return delta < 0 ? Math.max(...candidates) : Math.min(...candidates);
}

// Inclusive line range of the last command's output: from the C marker (the
// line after the command was entered) up to the line before the D marker, or
// to the end of the buffer while the command is still running.
export function outputRange(
  start: number | null,
  end: number | null,
  bufferLength: number,
): [number, number] | null {
  if (start === null || start < 0) return null;
  const last = (end ?? bufferLength) - 1;
  return last >= start ? [start, last] : null;
}
