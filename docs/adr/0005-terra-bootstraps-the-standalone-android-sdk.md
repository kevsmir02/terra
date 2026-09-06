# 0005. Terra bootstraps the standalone Android SDK

Status: accepted

Supersedes the "Bootstrapping the cmdline-tools too" alternative in
[0004](0004-sdk-install-runs-in-a-terminal-tab.md).

## Context

0004 gave the dock an install offer, and it bottomed out at `sdkmanager`.
`device_sdk_setup` resolved that binary and, failing to find it, returned
`canInstall: false` and a pointer at Android Studio's SDK Manager. So the offer
covered every case except the one a new user actually arrives in: a machine
with no Android SDK on it at all.

It was worse than a missing offer. With no SDK, `adb` does not resolve either,
so `deviceSession` reports `adb-missing`, `PaneFallback` renders `AdbMissing`,
and that component was a dead end naming `apt`, `brew` and `winget` on an
application that ships Linux only (0002). The offer lived three levels down a
path (`NoDevices` to `CreateAvd` to `InstallEmulator`) that only opens once adb
already resolves. The state that needed the most help was the one state
structurally unable to show it.

0004 considered fixing this and declined:

> **Bootstrapping the cmdline-tools too**, downloading the zip from
> `dl.google.com` and unpacking it [...] would give Terra a second outbound HTTP
> client beyond `updater_download`, a new host allowlist, and archive
> extraction, for the one case where the user has no Android SDK at all.

Every cost in that sentence is a cost of downloading in Rust. 0004's own
decision was that Terra does not download: it composes a line and hands it to a
terminal tab. Measured against that decision rather than against a Rust-side
implementation, the alternative was rejected for expenses it does not incur.

## Decision

Terra composes the bootstrap as one shell line and runs it in a terminal tab,
the same way it already runs `sdkmanager`.

`device_sdk_install_command` stays the single entry point and branches on
whether `sdkmanager` resolves. With cmdline-tools present it returns 0004's
line. Without them it returns `build_sdk_bootstrap_command`, which fetches the
command-line tools from `dl.google.com`, verifies them against a pinned digest,
unpacks them into `<root>/cmdline-tools/latest`, and ends in exactly the
`sdkmanager` call the other branch would have produced. Terra gains no HTTP
client, no host allowlist and no archive extraction, because it performs none
of those operations; `curl`, `sha256sum` and `unzip` do, in front of the user,
under their Ctrl-C, with `PtyState` owning teardown.

Completion detection is unchanged and needed no new machinery: both branches end
with a system image landing on disk, which is what `useSdkSetup` already polls
for while an install is in flight, and what already triggers AVD creation.

`SdkSetup` becomes a tagged union of `bootstrap`, `image` and `blocked`,
replacing a `canInstall` boolean that conflated "no cmdline-tools" with "no
image for this architecture" and so could not tell the two offers apart.
`AdbMissing` renders the create-or-install flow instead of package-manager
prose, which is what makes the offer reachable at all on a bare machine.

Three constraints shape the line, and each is locked by a test:

- **No `$` and no backtick.** `runInTerminal` submits into whatever shell the
  tab is running, and Terra supports fish, which has no `x=$(...)` assignment.
  That rules out `mktemp -d`, so the download stages in a fixed
  `<root>/.terra-bootstrap` instead.
- **`&&` throughout**, so a failed digest check never reaches the unzip.
- **No recursive delete.** After the `mv` the staging directory holds one file,
  so `rm -f` on that file and `rmdir`, which refuses a non-empty directory, are
  the whole cleanup. Terra never composes `rm -rf`.

The digest is pinned as sha256 even though Google's `repository2-3.xml`
publishes only sha1: the constant is derived once from the artifact after
checking it against that published sha1, and re-derived the same way on a bump.

Prerequisites (`curl`, `unzip`, `sha256sum`, `java`) are probed before the offer
appears. A missing one produces `blocked` with the tool named and no button,
which is the rule the rest of the app follows: offer a feature only where its
tool exists. Terra does not compose a `sudo` line to fix it.

## Alternatives considered

**Rust-side download with a progress bar**, the shape 0004 was actually costing.
It buys a nicer progress surface for a second network client, a zip extractor
needing path-traversal defence, a cancel command, an event channel, and another
teardown path on exit. And it still has to hand off to `sdkmanager` in a
terminal for the licences, so it adds a surface without removing one.

**Bootstrap the tools only, then reuse the existing image picker.** A shorter
line, but two clicks and two waits for one intention, and the first click ends
with nothing visible: no image, no AVD, the dock still empty.

**Pin Google's published sha1.** No local derivation and a mechanical bump, but
a broken hash as the only integrity check on a 173 MB executable payload. TLS
already authenticates the origin; the pin exists for what TLS does not cover,
so it should be a hash worth having.

**Write `ANDROID_HOME` and `PATH` into the user's shell rc**, as a hand-rolled
setup usually does. Terra does not need them (it probes `~/Android/Sdk`
directly), and editing shell startup files to benefit terminal tabs is a larger
intrusion than the benefit justifies.

## Consequences

A machine with a JDK and no Android SDK reaches a launchable emulator from one
button in the Devices dock, without Android Studio. The install is visible and
interruptible, and Terra still never holds a licence decision.

`CMDLINE_TOOLS_BUILD` and `CMDLINE_TOOLS_SHA256` join `CATALOG_API_LEVELS` as
constants that need bumping, and this pair costs a 173 MB download to re-derive.
A stale pin degrades gently: sdkmanager updates itself, and older cmdline-tools
install current packages, so the failure is "bootstrapped with an older tool",
never a broken install.

The line is long and does six things before it reaches `sdkmanager`. Read in a
terminal that is a fair description of what it is doing, but a failure midway
leaves a staging directory behind, and the panel notices only that no image ever
appeared. The "Check now" button and the visible terminal are the whole recovery
story, as in 0004.

One thing the first end-to-end run surfaced, worth knowing before the next
change here: cmdline-tools 23.0 prints "The SDK Manager CLI tool (sdkmanager) is
deprecated. Android CLI will be used instead" and delegates to a new `android`
binary shipped in the same directory, downloading it on first use. Both lines
still work through `sdkmanager`, and `avdmanager` (which `create_avd` uses) is
untouched, so nothing here changes yet. When it does, the replacement is
`android sdk`, and the pinned build is the lever for choosing when to move.

Refusing to run when `<root>/cmdline-tools/latest` already exists means a user
with a half-finished install gets an error rather than a repair. That is
deliberate: `mv` onto an existing directory nests inside it, and quietly
producing `latest/cmdline-tools/bin` would be worse than saying so.
