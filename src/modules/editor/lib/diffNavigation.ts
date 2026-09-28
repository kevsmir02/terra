type ChunkStepper = (dir: 1 | -1) => boolean;

let stepper: ChunkStepper | null = null;

/** The visible diff pane registers how to move between its changes; App's
 * shortcut and palette entries call through here, so the eager graph never
 * imports CodeMirror to reach it. */
export function registerDiffChunkStepper(fn: ChunkStepper): () => void {
  stepper = fn;
  return () => {
    if (stepper === fn) stepper = null;
  };
}

export function canStepDiffChunk(): boolean {
  return stepper !== null;
}

export function stepDiffChunk(dir: 1 | -1): boolean {
  return stepper?.(dir) ?? false;
}

export type HunkShortcut = "stage" | "discard";
type HunkRunner = (kind: HunkShortcut) => boolean;

let hunkRunner: HunkRunner | null = null;

/** Same seam for acting on the selected change: the pane that shows one
 * registers, App's shortcuts call through without importing the pane. */
export function registerHunkRunner(fn: HunkRunner): () => void {
  hunkRunner = fn;
  return () => {
    if (hunkRunner === fn) hunkRunner = null;
  };
}

export function canRunHunkShortcut(): boolean {
  return hunkRunner !== null;
}

export function runHunkShortcut(kind: HunkShortcut): boolean {
  return hunkRunner?.(kind) ?? false;
}
