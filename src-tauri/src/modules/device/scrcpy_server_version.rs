/// Pinned scrcpy server version. The bundled JAR (`tauri.conf.json` resource)
/// and the standalone-server `app_process` invocation share this constant so
/// they bump together. See Device Preview Pane design spec
/// (docs/superpowers/specs/2026-07-23-device-preview-pane-design.md).
pub const SCRCPY_SERVER_VERSION: &str = "4.1";
