# 0008. Turn checkpoints are session-scoped refs under refs/terra

Status: accepted.

## Context

An agent turn can touch many files, and the question after it hands back is
"what did it change, and can I undo it". Git alone answers only against HEAD or
the index, both of which already hold the user's own uncommitted work, so a
diff against them mixes the turn with everything before it. Terra needs a
snapshot of the working tree at the moment a turn starts, taken without
disturbing anything the user owns: the index, HEAD, the stash list and the
worktree itself.

A snapshot has a cost. `git add -A` hashes every changed and untracked file
into the object database, and a repo with a large unignored build directory
could stall for seconds and write hundreds of megabytes of loose objects on
every turn.

## Decision

**Trigger.** The frontend listens for `terra:agent-signal` only while the
`agentCheckpoints` setting is on (default on). `started` and `working` for a
pane call `git_checkpoint_create(cwd, pane)` on the blocking pool; the PTY
reader never waits on it. One snapshot per pane runs at a time and starts that
land during it fold into one follow-up. Off, there is no listener and the
listener module is never fetched.

**Snapshot.** In the repo holding the pane's cwd (nothing outside a repo):

1. Copy the real index to a private temp file. The copy keeps stat data, so
   the next step hashes only what changed.
2. `write-tree` on the copy records the index as it was, when it has no
   conflicts.
3. `GIT_INDEX_FILE=<copy> git add --all` then `write-tree` gives the working
   tree as a tree object, `.gitignore` respected.
4. `commit-tree` (fixed Terra identity, `--no-gpg-sign`) makes an index commit
   on HEAD and a worktree commit on that, with the index commit named in a
   `Terra-Index:` trailer, and `update-ref` points
   `refs/terra/checkpoints/<session>-<pane>-<millis>` at it.

The real index is only ever read, HEAD and branches never move, no hook runs,
and `refs/terra/*` is outside every namespace `log`, `branch`, `stash` or a push
looks at. The refs keep the objects reachable, so `gc` cannot collect a live
checkpoint. If the tree and index are unchanged since the pane's last
checkpoint, that one is reused rather than a new commit written.

**Cost cap.** Before hashing, `git ls-files --modified --others
--exclude-standard` lists what `add -A` would hash. Over 5,000 files or 64 MiB,
or any git step over 20 s, the snapshot is skipped: nothing is hashed, the
pane's previous checkpoint is dropped (measuring this turn against an earlier
one would be wrong) and one toast per repo per session says why.

**Retention.** Checkpoints belong to the app run that took them. Pane ids do
not survive a relaunch, so nothing could reach an older run's checkpoint
anyway.

- Each new checkpoint prunes the repo to the newest 3 per pane and 20 per
  repo, and drops anything older than 7 days (a crashed run's leftovers).
- `RunEvent::Exit` deletes every ref this run created, in every repo it
  touched (`CheckpointState::drop_all`, 5 s timeout per git call).
- Unreferenced objects are then ordinary garbage for `gc`.

**Use.** "Changes this turn" snapshots the working tree the same way (same
caps) and runs `diff-tree` against the checkpoint, so created, modified and
deleted files all show, gitlinks excluded. Each file opens in a diff tab whose
original side is the checkpoint blob. "Revert turn" takes the exact list the
user confirmed, recomputes the turn's changes, and refuses the whole request if
any path is no longer one of them. It restores modified and deleted files with
`git --literal-pathspecs restore --worktree --source=<checkpoint>` and removes
files the turn created (never a directory). The index is touched only when the
user ticks the box, and then only for those paths, back to the recorded index
commit with `restore --staged`.

## Consequences

- A snapshot races the agent: the `working` signal arrives as the turn starts,
  and an edit that lands before `add -A` reads the file is in the checkpoint
  rather than in the turn. The hooks emit the marker before the model runs, so
  this is rare, but "this turn" is best effort at the edges.
- Every checkpoint writes blobs for new content. Identical content is shared
  across checkpoints and with the user's own objects, and the caps bound the
  worst case.
- Reverting restores the worktree, so a user edit made during the turn to one
  of the listed files is reverted with it. The confirmation lists every file for
  that reason.
- Ignored files are neither snapshotted nor reverted. An agent writing into
  `node_modules` is outside this feature.
- Empty directories a turn created stay behind: git records none, so the
  checkpoint cannot tell them from the user's.
