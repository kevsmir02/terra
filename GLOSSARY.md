# GLOSSARY.md

Terms this project uses for Android device mirroring, defined once here so the
host process and the webview describe it the same way.

- **Device**: any target adb can address, physical or emulated.
- **Serial**: the adb identifier for a Device.
- **Readiness**: whether a Device is usable, replacing the current practice of
  comparing a Device's raw state string against the literal value "device".
- **AVD**: an emulator definition on disk.
- **Emulator**: a running instance of an AVD.
- **Session**: one live capture of one Device, owned by the host process.
- **Mirror**: the live picture of a Session as seen in the webview.
- **Dock**: the right hand panel the Mirror is displayed in.
