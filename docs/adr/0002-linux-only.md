# 0002. Terra is Linux only

Status: accepted

## Context

Terra is a personal fork used by one person on Fedora. Upstream Terax shipped
for macOS and Windows as well, and the fork inherited every arm of that
support: a Windows shell integration module with its own PowerShell profile,
ConPTY spawn serialization, Job Objects to reap process trees, a WSL bridge
that translated paths and ran git and shells through `wsl.exe`, macOS RSS
probing, window centering and press-and-hold handling, `objc2` and
`windows-sys` as target dependencies, per-platform bundle sections, and two
CI jobs whose only purpose was to prove the other platforms still compiled.

On 2026-09-05 the stance was first written down as "keep them compiling, do
no work on them". That stance still cost something: around 1500 lines of Rust
nobody could run, a `WorkspaceEnv` parameter threaded through every
filesystem, git, PTY and language-server call so that a WSL distro could be
named, platform branches in the header, shortcuts, clipboard and OSC parsing,
and a General settings tab that queried WSL distros on every open of a Linux
machine. None of it had a user.

## Decision

Everything that exists only for macOS, Windows, or WSL is removed. No
`#[cfg(windows)]` or `#[cfg(target_os = "macos")]` arm remains, no crate is
declared for another target, the bundle builds deb, rpm and AppImage only, and
CI runs on Linux only. The frontend has no platform constant; the custom
window controls always render and the primary modifier is always Ctrl.

A change that would need platform-specific code is out of scope. The fork is
public so it can be forked; someone who wants another platform starts from
upstream, not from here.

## Alternatives considered

**Keep the arms behind `cfg` and keep them compiling.** This is what the tree
did for a day. It is cheaper than porting but not free: every touch of the PTY,
git, or workspace code had to keep an arm it could not run correct, and the
compile-only guarantee proved nothing about behaviour. Code that cannot be
exercised is a liability with a maintenance cost and no return.

**Keep WSL as a Linux-reachable feature.** WSL is a Windows facility; on Linux
its commands were permanent no-ops. There was nothing to keep.

## Consequences

The Rust tree loses the `proc` module, the WSL bridge, the Windows shell
initialization, and every platform-gated block. `WorkspaceEnv` collapses to a
single variant and its parameter is removed from every command and wrapper.
Paths are Unix paths; nothing normalizes drive letters or backslashes for a
host that does not exist.

Reintroducing a platform means reintroducing all of it at once, with tests that
run on that platform. Until then the answer to "does this work on macOS" is no.
