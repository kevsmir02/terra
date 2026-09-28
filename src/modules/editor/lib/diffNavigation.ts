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
