import type { GitStatusCode } from "./gitStatusUtils";

// Soft filename tint, new-VS-Code direction: color the name, no badges.
export function explorerGitTextClass(code: GitStatusCode): string {
  switch (code) {
    case "M":
      return "text-status-modified";
    case "A":
    case "U":
      return "text-status-added";
    case "R":
      return "text-status-renamed";
    case "D":
      return "text-status-deleted";
  }
}
