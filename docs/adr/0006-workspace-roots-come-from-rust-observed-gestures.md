# 0006. Workspace roots come from gestures Rust observes

Status: accepted.

## Context

`WorkspaceRegistry` answers "may the webview touch this path" for fs, git, PTY
and LSP spawn, and the asset protocol. TERRA.md said roots are added only by a
user gesture, but two webview-facing paths granted whatever they were handed:

- `workspace_authorize(path)` registered any existing path as a root. The
  frontend called it for every OSC 7 `cd`, for `$HOME`, for a space root typed
  in Settings and for every saved tab cwd at boot. Script running in the
  webview could call `workspace_authorize("/")` and every gate after it would
  pass.
- `pty_open(cwd)` went through `authorize_user_spawn_cwd`, which registered the
  spawn cwd as a root, so the same call with `cwd: "/"` did the same thing.

The frontend's OSC 7 handler already ignores reports that arrive while a
command runs (OSC 133 B/C to A/D), because command output is untrusted, but it
then forwarded the path to a command that trusted it unconditionally.

## Decision

Every root grant originates from a source the Rust side observes itself. The
webview can no longer name a path and have it granted.

| Source | Where the grant happens |
| --- | --- |
| Launch cwd, CLI arguments, `$HOME` | `bootstrap_registry` and `run()` in `lib.rs`, before the webview loads |
| A real OS drag-drop | the `DragDrop` window event in `lib.rs` |
| A terminal `cd` | `pty/cwd_detect.rs` in the PTY reader, then `workspace::grant_shell_cwd` |
| A space root typed in Settings | `workspace_grant_root`, after a native GTK confirmation |
| Saved spaces and tab cwds at boot | `workspace_restore_roots`, once per process |

`workspace_authorize` and `authorize_user_spawn_cwd` are gone. `pty_open` uses
the covered-only `authorize_spawn_cwd` and opens the terminal in home when the
requested cwd is outside every root.

**Terminal `cd`.** The reader parses OSC 7 from the byte stream the way
`agent_detect.rs` and `url_detect.rs` already filter it, mirroring the
frontend's rule that a report between OSC 133 B/C and A/D is command output.
Because any program can also print a fake OSC 133 D followed by OSC 7, a path
that is not already covered is granted only when it equals
`/proc/<pid>/cwd` of the shell or of the tty's foreground process group leader
(a nested shell reports its own cwd). A covered path skips the lookup. The
grant happens before the bytes are queued for the webview, so the explorer's
first read of the new cwd already passes.

**Typed space roots.** Script in the webview and a user typing produce the same
IPC call, so the call alone cannot be a gesture. A root already covered
resolves immediately; anything else raises a modal GTK dialog, transient for
the calling window, that the webview cannot see or drive. Only "Allow access"
grants. The dialog is native rather than themed on purpose: a prompt the
webview could render is a prompt the webview could fake. `gtk` is already
linked through Tauri, so the direct dependency adds no code.

**Boot restore.** Saved spaces need their roots and their terminals' last cwds
back before any tab spawns, and prompting for each at every launch would be
noise. `workspace_restore_roots` grants existing directories from the list it
is given (at most 256) and then refuses every later call for the life of the
process. Boot calls it exactly once, on every path through `useSpacesBoot`
including the first-run and error paths, before any file tree, markdown
preview or other untrusted content has rendered.

## Consequences

- A terminal restored at boot whose saved cwd is outside home now opens in that
  cwd only because boot restored it; a tab created later with an invented cwd
  opens in home.
- A `cd` that the `/proc` check cannot confirm (a `sudo -s` root shell whose
  cwd is unreadable, a tmux pane whose OSC 7 is passed through from a
  different pty, a report that races a second `cd`) moves the tab's cwd in the
  UI but grants nothing. The explorer shows the gate's error for that
  directory until a confirmed `cd` or a typed root covers it.
- A typed root outside the current roots costs one native prompt per session
  in which it is newly typed; saved roots do not prompt again.

## Residual risk

The registry narrows what the webview can reach; it is not a sandbox against a
fully compromised webview, and this decision does not pretend otherwise.

- `pty_write` types into a shell with the user's privileges. Script that can
  call it can run any command, including `cd /`, which the reader will then
  confirm and grant.
- The boot restore list comes from the settings store, and `tauri-plugin-store`
  (`store:default`) resolves a store path by joining it onto the app data dir,
  which accepts an absolute path. Script can therefore rewrite the saved
  spaces, and the next launch restores whatever roots they name. The same
  plugin can write JSON to any path the user can write, which is a larger
  hole than this registry and should be closed by scoping the store plugin.
- `git::operations` still widens a covered cwd to its repository's toplevel.
  That grant follows from a path already covered, but a repository rooted
  high in the tree (a `git init` in `/` or `$HOME`'s parent) widens far.
- The `/proc` match proves the path is a live process's cwd, not that the user
  typed the `cd`: a foreground program can `chdir` itself, print a fake OSC 133
  D and then an OSC 7 naming its own cwd, and the check passes.
