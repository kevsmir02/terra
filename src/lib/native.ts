import { invoke } from "@tauri-apps/api/core";

export type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
  gitignored: boolean;
};

export type GrepHit = {
  path: string;
  rel: string;
  line: number;
  text: string;
};

export type GrepResponse = {
  hits: GrepHit[];
  truncated: boolean;
  files_scanned: number;
};

export type GlobHit = { path: string; rel: string };
export type GlobResponse = { hits: GlobHit[]; truncated: boolean };

export type GitRepoInfo = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
};

export type GitChangedFile = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  /** An unmerged path; git's XY alone misses both-added and deleted-by-them. */
  conflicted: boolean;
  statusLabel: string;
};

export type GitRepoOperation =
  | "merge"
  | "rebase"
  | "cherry-pick"
  | "revert"
  | "am";

export type GitStatusSnapshot = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isDetached: boolean;
  truncated: boolean;
  /** The operation the repo is stopped in, read from the git dir markers. */
  operation: GitRepoOperation | null;
  changedFiles: GitChangedFile[];
};

export type GitDiffContentResult = {
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
  /** The patch hit the output cap and is only its start. */
  truncated: boolean;
  /** A side is over the content cap: both contents are empty, use the patch. */
  tooLarge: boolean;
  /** Unmerged path: original is ours (stage 2), modified is theirs (stage 3). */
  conflict: boolean;
};

export type GitCommitResult = {
  commitSha: string;
  summary: string;
};

export type GitPushResult = {
  remote: string | null;
  branch: string | null;
  pushed: boolean;
};

export type GitLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  timestampSecs: number;
  parents: string[];
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitCommitFileChange = {
  path: string;
  originalPath: string | null;
  status: string;
  statusLabel: string;
  added: number;
  removed: number;
  isBinary: boolean;
};

export type GitPanelSnapshot = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
};

export type GitDiscardEntry = {
  path: string;
  untracked: boolean;
};

export type GitBranchEntry = {
  name: string;
  kind: "local" | "worktree";
  worktreePath: string | null;
  isHead: boolean;
  isDetached: boolean;
};

export type GitBranchListResult = {
  branches: GitBranchEntry[];
};

export type GitStashEntry = {
  name: string;
  message: string;
};

export const native = {
  workspaceCurrentDir: () => invoke<string>("workspace_current_dir"),
  /** Grants a typed space root, asking the user natively when it is new. */
  workspaceGrantRoot: (path: string) =>
    invoke<string>("workspace_grant_root", {
      path,
    }),
  /** Boot only: re-grants saved roots once per process, then refuses. */
  workspaceRestoreRoots: (paths: string[]) =>
    invoke<string[]>("workspace_restore_roots", {
      paths,
    }),
  /** Grants `asset://` access to one file and returns its canonical path. */
  allowAsset: (path: string) =>
    invoke<string>("fs_allow_asset", {
      path,
    }),
  readFile: (path: string) =>
    invoke<ReadResult>("fs_read_file", {
      path,
    }),
  writeFile: (path: string, content: string) =>
    invoke<void>("fs_write_file", {
      path,
      content,
    }),
  canonicalize: (path: string) =>
    invoke<string>("fs_canonicalize", {
      path,
    }),
  createFile: (path: string) => invoke<void>("fs_create_file", { path }),
  createDir: (path: string) => invoke<void>("fs_create_dir", { path }),
  readDir: (path: string) =>
    invoke<DirEntry[]>("fs_read_dir", {
      path,
      showHidden: false,
    }),
  grep: (params: {
    pattern: string;
    root: string;
    glob?: string[];
    caseInsensitive?: boolean;
    maxResults?: number;
  }) =>
    invoke<GrepResponse>("fs_grep", {
      pattern: params.pattern,
      root: params.root,
      glob: params.glob ?? null,
      caseInsensitive: params.caseInsensitive ?? null,
      maxResults: params.maxResults ?? null,
    }),
  glob: (params: { pattern: string; root: string; maxResults?: number }) =>
    invoke<GlobResponse>("fs_glob", {
      pattern: params.pattern,
      root: params.root,
      maxResults: params.maxResults ?? null,
    }),
  gitResolveRepo: (cwd: string) =>
    invoke<GitRepoInfo | null>("git_resolve_repo", {
      cwd,
    }),
  gitPanelSnapshot: (cwd: string) =>
    invoke<GitPanelSnapshot>("git_panel_snapshot", {
      cwd,
    }),
  gitStatus: (repoRoot: string) =>
    invoke<GitStatusSnapshot>("git_status", {
      repoRoot,
    }),
  gitFetch: (repoRoot: string) =>
    invoke<void>("git_fetch", {
      repoRoot,
    }),
  gitPullFfOnly: (repoRoot: string) =>
    invoke<void>("git_pull_ff_only", {
      repoRoot,
    }),
  gitPush: (repoRoot: string) =>
    invoke<GitPushResult>("git_push", {
      repoRoot,
    }),
};
