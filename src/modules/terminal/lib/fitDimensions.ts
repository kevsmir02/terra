export const MIN_COLS = 2;
export const MIN_ROWS = 1;

export type CellSize = { width: number; height: number };
export type Box = { width: number; height: number };
export type Dimensions = { cols: number; rows: number };

/**
 * Grid that fills `box` at `cell`, or null when either input is not measurable
 * yet (a slot parked behind display:none reports zero).
 *
 * Deliberately not FitAddon.proposeDimensions. That subtracts
 * `overviewRuler?.width || 14` from the available width whenever scrollback is
 * enabled, reserving a gutter for a scrollbar Terra hides app-wide in
 * globals.css and an overview ruler Terra never turns on. The reservation is
 * unconditional and cannot be zeroed through options, because a width of 0 is
 * falsy and falls back to the 14px default. The visible result was a dead
 * strip down the right edge of every terminal, wide enough for one to two
 * columns of a full-width TUI.
 */
export function proposeDimensions(box: Box, cell: CellSize): Dimensions | null {
  if (!(cell.width > 0) || !(cell.height > 0)) return null;
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
  if (box.width <= 0 || box.height <= 0) return null;
  return {
    cols: Math.max(MIN_COLS, Math.floor(box.width / cell.width)),
    rows: Math.max(MIN_ROWS, Math.floor(box.height / cell.height)),
  };
}
