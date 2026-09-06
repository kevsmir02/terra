export type RowGesture = "click" | "dblclick";

export type RowActivation =
  | "toggle"
  | "open-preview"
  | "open"
  | "rename"
  | "none";

// Selection happens on every click regardless; this decides what else a
// gesture on a tree row does. With open-on-double-click on, a single click
// only selects and the double click opens a pinned tab.
export function rowActivation(
  gesture: RowGesture,
  isDir: boolean,
  openOnDoubleClick: boolean,
): RowActivation {
  if (isDir) return gesture === "click" ? "toggle" : "none";
  if (openOnDoubleClick) return gesture === "dblclick" ? "open" : "none";
  return gesture === "click" ? "open-preview" : "rename";
}
