# 0004. Installing an Android system image runs in a terminal tab

Status: accepted. The "Bootstrapping the cmdline-tools too" alternative below is
superseded by [0005](0005-terra-bootstraps-the-standalone-android-sdk.md), which
found its stated costs to be costs of downloading in Rust rather than of the
bootstrap itself. The decision recorded here is unchanged.

## Context

Device Preview needs three things before it can mirror an emulator: the
platform-tools, the `emulator` package, and at least one system image. Until
now Terra could only work with what was already on disk. `list_system_images`
walks `<sdk>/system-images`, and when that walk came back empty the panel said
"install one from Android Studio's SDK Manager" and stopped. `create_avd` even
carried the reasoning in a comment: downloading an image needs sdkmanager,
licence acceptance and a progress UI, and all three were declared out of scope.

That dead end is the wrong shape for the product. A developer who opens the
dock to look at what an agent just built has to leave for Android Studio, find
the SDK Manager, guess which image matches their machine, come back and hit
Refresh. Terra already knows the answer to all of it.

Doing the install is not one decision but four: what the user is allowed to
pick, where the bytes come from, who accepts Google's SDK licences, and what
the progress looks like. The last two are where the weight is. An install is
multiple gigabytes over minutes, and `sdkmanager` will not download anything
until a licence prompt is answered.

## Decision

Terra resolves the `sdkmanager` command line and runs it in a terminal tab.

`device_sdk_install_command` returns one shell line; `runInTerminal` in
`App.tsx` opens a terminal tab in the active space and submits it, the same
path a space's `startupCommands` take. The progress bar is sdkmanager's own,
the licence prompt is answered by the user in the terminal, Ctrl-C cancels, and
`PtyState` already owns teardown on tab close and on `RunEvent::Exit`.

Because there is no exit code to observe from the panel, completion is defined
as the image appearing on disk: while an install is in flight `useSdkSetup`
re-walks `device_list_system_images` every ten seconds, then creates an AVD
from the installed image and stops. The poll exists only while that surface is
live, and there is no timer at all when nothing is installing.

The catalog is a hardcoded shortlist (the last three API levels, `google_apis`,
the host ABI) rather than `sdkmanager --list`, which is slow and hits the
network for a list that changes a few times a year.

## Alternatives considered

**A managed child process with a progress bar in the dock.** Spawn sdkmanager
detached, parse its stdout percentages, stream them to the panel, offer Cancel,
and gate the whole thing behind an "I accept the Android SDK licences"
checkbox that pipes `y`. It is the prettier surface, and it is the wrong trade
twice over. It makes Terra a party to accepting a legal agreement on the user's
behalf, restating Google's terms in a checkbox Terra would have to keep
accurate. And it is a whole new long-running process host: another `DeviceState`
entry, another event channel, a cancel command, another teardown path on exit,
and a stdout parser to keep working across sdkmanager versions. The terminal is
this product's primary surface; routing a long noisy command to it is the
cheaper answer and the more honest one.

**Bootstrapping the cmdline-tools too**, downloading the zip from
`dl.google.com` and unpacking it, so a bare machine could go from nothing to a
running emulator. That would give Terra a second outbound HTTP client beyond
`updater_download`, a new host allowlist, and archive extraction, for the one
case where the user has no Android SDK at all. Without sdkmanager the panel
shows instructions and no button, which is the same rule the rest of the app
follows: offer a feature only where its tool exists.

**Printing the command with a copy button.** Near-zero code and zero risk, but
it is barely more than the dead end it replaces, and it makes the user the
courier between two panes of the same window.

## Consequences

The install is visible and interruptible, and Terra never holds a licence
decision. The cost is that the user is handed a terminal rather than a
progress bar, and that a cancelled or failed install is noticed only as an
image that never appears; the panel keeps a "Check now" button so the wait is
never longer than the user's patience.

Terra builds a shell *line* rather than an argv, which is a boundary the module
did not previously have. Package ids contain `;` and an SDK root can contain a
space or a quote, so `build_sdk_install_command` validates every package
against the catalog and single-quotes every element, and refuses a path that is
not UTF-8 or that carries a control character. That is locked by a test that
runs the produced line back through `sh` and asserts the argv comes out
unchanged.

Bumping `CATALOG_API_LEVELS` is now part of following Android releases. The
cost of missing a bump is that Terra offers an older image than it could, which
is a much smaller failure than a slow network call on every panel open.
