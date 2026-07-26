/** How the open buffer relates to the file on disk.
 *
 * `useEditorFileSync` already reloads tabs on fs-watch events, but `reload()`
 * refuses to run while the buffer is dirty so unsaved edits are never
 * clobbered. That refusal used to be silent: the user only learned the file had
 * moved when a later save raised a conflict. This state is what the editor
 * surfaces instead. */
export type DiskState = "in-sync" | "changed" | "missing";

export type DiskEvent =
  /** An fs event arrived for this path but the buffer was dirty, so the file
   *  was never re-read. */
  | { kind: "reload-skipped-dirty" }
  /** The file was re-read and the buffer now matches disk. */
  | { kind: "reload-succeeded" }
  /** The file was still absent when re-checked after the atomic-rename grace
   *  period, so it is genuinely gone rather than mid-rename. */
  | { kind: "confirmed-missing" }
  /** A save completed: the buffer became the disk contents, recreating the file
   *  if it had been deleted. */
  | { kind: "saved" }
  /** The user chose the disk copy over their edits. */
  | { kind: "discarded" };

export function nextDiskState(current: DiskState, event: DiskEvent): DiskState {
  switch (event.kind) {
    case "reload-skipped-dirty":
      // A skipped reload reads nothing, so it is no evidence a missing file
      // came back. Downgrading to "changed" here would offer "Reload from
      // disk" for a file that cannot be read.
      return current === "missing" ? "missing" : "changed";
    case "reload-succeeded":
    case "saved":
    case "discarded":
      return "in-sync";
    case "confirmed-missing":
      return "missing";
  }
}
