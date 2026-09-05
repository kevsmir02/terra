# 0001. The device mirror does not reconnect automatically

Status: accepted

## Context

A mirror session is a scrcpy server on the device, an adb forward, and a TCP
socket the Rust reader drains into fMP4 frames. Any of those can die: the phone
is unplugged, the emulator is stopped, USB debugging is revoked, the device
sleeps, adb is restarted from another terminal, or the packet stream
desynchronizes past the point where the assembler can resynchronize it.

Until now the webview never learned that any of this had happened. The reader
thread returned, the frames stopped, and the last decoded frame stayed on
screen looking exactly like a live but idle device. The session now reports why
it stopped on an exit channel, which raises the question the report forces:
what should the app do next.

The obvious answer is to reconnect. Every cause listed above is transient in
principle, and a mirror that heals itself while the user is looking at another
tab would feel good in the cases where it works.

## Decision

Terra reports the death and stops. The pane keeps the frozen last frame on
screen, dims it, names the reason, and offers a Reconnect button. Nothing
retries on a timer, and no code path opens a session that a user did not ask
for. The Rust reader also distinguishes a death from a teardown: when
`shutdown` set `stopping` before closing the sockets, the woken read reports
nothing, so closing the dock is never presented as a failure.

## Alternatives considered

**Automatic respawn with backoff, as the language server host does.** The LSP
session manager respawns a crashed server after a cooldown of 2, 10 and 30
seconds, and gives up after three crashes in five minutes. That is right for a
language server: it is invisible, it costs nothing the user can perceive, and
the alternative is silently broken completions. A mirror is the opposite on
every count. Reconnecting means pushing a JAR, re-forwarding two ports and
starting a process on the user's phone, and on several of the failure causes it
is actively wrong: a device that revoked USB debugging shows an authorization
dialog on every attempt, a sleeping phone wakes, and an emulator the user just
stopped starts talking again. A retry loop against a device that is genuinely
gone also burns adb invocations and battery for as long as the dock stays open,
which is precisely the cost this product does not spend without being asked.

**Reconnect only for reasons that look transient**, such as `stream-ended` but
not `stream-corrupt`. The reasons do not carry enough information to make that
call. `stream-ended` covers both the emulator the user killed on purpose and
the cable that wobbled, and guessing wrong in the first case is the hostile
outcome.

**A countdown with a cancel**, reconnecting in five seconds unless the user
stops it. This makes the automatic path opt-out rather than opt-in for a state
the user may not be looking at, and it adds a timer to a pane that is often
sitting in the background. The button is the same gesture with none of that.

## Consequences

A dead mirror stays dead until the user clicks Reconnect. That is one click of
friction in the case where the reconnect would have worked, and it is the
correct behaviour in every case where it would not have.

Recovery has exactly one path, the key-bump remount in `DevicePreviewPane`, so
there is one code path to keep correct rather than a retry policy to tune. The
remount reuses the existing race protection: the old session's close is tracked
by serial, and the new session waits it out before calling `device_open`.

The exit reason has to be worth reading, since the user decides from it whether
to reconnect at all. `exitMessage` in `deviceSession.ts` maps each wire reason
to one plain line, and an unrecognized reason falls back to the generic line
rather than showing an internal token.
