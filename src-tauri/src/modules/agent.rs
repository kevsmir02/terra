use serde_json::{json, Value};

// How a given agent's hook delivers our OSC 777 marker into the terminal.
#[derive(Clone, Copy)]
enum Delivery {
    // Claude returns the sequence via a `terminalSequence` JSON field (it lost
    // /dev/tty access in v2.1.139) and emits it in-band.
    TerminalSequence,
    // Codex hooks can't write to the terminal, so the hook command emits
    // the marker itself to /dev/tty.
    Osc,
    // OpenCode 2 has no hook config: a TUI plugin file of ours, loaded by the
    // terminal client (not the shared background server, which has no tty for
    // this pane), writes the 4-field marker to /dev/tty.
    TuiPlugin,
}

// Where `dir` is rooted: `$HOME`, or the XDG config dir OpenCode reads.
#[derive(Clone, Copy)]
enum Base {
    Home,
    Config,
}

struct AgentSpec {
    agent: &'static str,
    base: Base,
    dir: &'static str,
    file: &'static str,
    // (the agent's event, our marker). For a plugin the event names are the
    // ones the plugin subscribes to; only the markers are checked.
    events: &'static [(&'static str, &'static str)],
    delivery: Delivery,
}

const AGENTS: &[AgentSpec] = &[
    AgentSpec {
        agent: "claude",
        base: Base::Home,
        dir: ".claude",
        file: "settings.json",
        events: &[
            ("UserPromptSubmit", "working"),
            ("Notification", "attention"),
            ("Stop", "finished"),
        ],
        delivery: Delivery::TerminalSequence,
    },
    AgentSpec {
        agent: "codex",
        base: Base::Home,
        dir: ".codex",
        file: "hooks.json",
        events: &[
            ("UserPromptSubmit", "working"),
            ("PermissionRequest", "attention"),
            ("Stop", "finished"),
        ],
        delivery: Delivery::Osc,
    },
    AgentSpec {
        agent: "opencode",
        base: Base::Config,
        dir: "opencode/plugins/terra",
        file: "tui.js",
        events: &[
            ("session.execution.started", "working"),
            ("permission.asked", "attention"),
            ("session.idle", "finished"),
        ],
        delivery: Delivery::TuiPlugin,
    },
];

// First line of the plugin we write. A file at our path without it belongs to
// someone else and is never overwritten.
const PLUGIN_OWNER: &str = "// terra-opencode-notify:";

// Only the routed session (and its subagents, for permission prompts) counts:
// every TUI client sees every session on the shared server, including ones
// open in other panes.
const OPENCODE_PLUGIN: &str = r#"// terra-opencode-notify: written by Terra. Reinstall from Terra's agent panel.
// Tells Terra what this pane's OpenCode session is doing through OSC 777.
import { closeSync, openSync, writeSync } from "node:fs";

const WORKING = "\x1b]777;notify;Terra;opencode;working\x07";
const ATTENTION = "\x1b]777;notify;Terra;opencode;attention\x07";
const FINISHED = "\x1b]777;notify;Terra;opencode;finished\x07";

function write(seq) {
  let fd;
  try {
    fd = openSync("/dev/tty", "w");
    writeSync(fd, seq);
  } catch {
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export default {
  id: "terra.notify",
  setup(context) {
    if (!process.env.TERRA_TERMINAL) return () => {};
    let last = "";
    const emit = (seq) => {
      if (seq === last && seq !== ATTENTION) return;
      last = seq;
      write(seq);
    };
    const current = () => {
      const route = context.ui.router.current();
      return route && route.type === "session" ? route.sessionID : null;
    };
    const own = (id) => id != null && id === current();
    const ownOrChild = (id) =>
      own(id) ||
      (current() !== null && context.data.session.get(id)?.parentID === current());
    const on = (type, fn) => {
      try {
        return context.data.on(type, (event) => fn(event?.data?.sessionID));
      } catch {
        return () => {};
      }
    };
    const stops = [
      on("session.execution.started", (id) => own(id) && emit(WORKING)),
      on("permission.replied", (id) => ownOrChild(id) && emit(WORKING)),
      on("permission.asked", (id) => ownOrChild(id) && emit(ATTENTION)),
      on("session.idle", (id) => own(id) && emit(FINISHED)),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  },
};
"#;

// Substrings identifying a hook command as ours, across every form we've ever
// emitted (legacy /dev/tty Claude, current TerminalSequence, Osc, the old
// Windows helper). Used to prune our own groups before reinserting so installs are
// idempotent and migrate older markers.
//
// The `Terax` spellings predate the rename. They must stay: pruning is what
// stops a reinstall from leaving the old hook in place alongside the new one
// and firing every notification twice.
const OWNED_MARKERS: [&str; 6] = [
    "notify;Terra;",
    "terra;notify",
    "__terra_notify",
    "notify;Terax;",
    "terax;notify",
    "__terax_notify",
];

fn find(agent: &str) -> Result<&'static AgentSpec, String> {
    AGENTS
        .iter()
        .find(|s| s.agent == agent)
        .ok_or_else(|| format!("unknown agent {agent}"))
}

fn hook_command(spec: &AgentSpec, event: &str) -> String {
    match spec.delivery {
        Delivery::TerminalSequence => format!(
            r#"[ -n "$TERRA_TERMINAL" ] && printf '{{"terminalSequence":"\\u001b]777;notify;Terra;{event}\\u0007"}}' || true"#
        ),
        Delivery::Osc | Delivery::TuiPlugin => osc_command(spec.agent, event),
    }
}

// Marker to the tty, then `{}` on stdout: Codex requires a JSON no-op.
fn osc_command(agent: &str, event: &str) -> String {
    format!(
        r#"[ -n "$TERRA_TERMINAL" ] && printf '\033]777;notify;Terra;{agent};{event}\007' > /dev/tty; printf '{{}}'"#
    )
}

// The stable substring that proves a given (agent, event) hook is installed.
// Kept in sync with hook_command so status reflects what enable writes.
fn status_needle(spec: &AgentSpec, event: &str) -> String {
    match spec.delivery {
        Delivery::TerminalSequence => format!("notify;Terra;{event}"),
        Delivery::Osc | Delivery::TuiPlugin => format!("notify;Terra;{};{event}", spec.agent),
    }
}

// A plugin is ours whole, so anything but the current source (an older Terra's,
// a hand edit) reads as not installed and Enable rewrites it.
fn is_installed(spec: &AgentSpec, content: &str) -> bool {
    match spec.delivery {
        Delivery::TuiPlugin => content == OPENCODE_PLUGIN,
        _ => spec
            .events
            .iter()
            .all(|(_, m)| content.contains(&status_needle(spec, m))),
    }
}

// What to write over a plugin file that may already exist: `None` when ours
// is current, an error when the file is someone else's.
fn plugin_update(existing: Option<&str>, path: &std::path::Path) -> Result<Option<&'static str>, String> {
    match existing {
        Some(s) if s == OPENCODE_PLUGIN => Ok(None),
        Some(s) if !s.starts_with(PLUGIN_OWNER) => Err(format!(
            "{} was not written by Terra; refusing to overwrite",
            path.display()
        )),
        _ => Ok(Some(OPENCODE_PLUGIN)),
    }
}

fn is_ours(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| {
            hs.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|c| OWNED_MARKERS.iter().any(|m| c.contains(m)))
            })
        })
}

// A group with no hooks is inert cruft (e.g. left behind when someone deletes
// our command but not its wrapper). Drop it so the file stays clean.
fn is_empty_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_none_or(|hs| hs.is_empty())
}

fn merge_hooks(mut root: Value, spec: &AgentSpec) -> Value {
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();

    for (event, marker) in spec.events {
        let arr = hooks.entry(*event).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        let arr = arr.as_array_mut().unwrap();
        arr.retain(|group| !is_ours(group) && !is_empty_group(group));
        arr.push(json!({
            "hooks": [ { "type": "command", "command": hook_command(spec, marker) } ]
        }));
    }
    root
}

fn existing_config(contents: Option<&str>, path: &std::path::Path) -> Result<Value, String> {
    match contents {
        Some(s) if !s.trim().is_empty() => serde_json::from_str::<Value>(s).map_err(|e| {
            format!("{} is not valid JSON ({e}); refusing to overwrite", path.display())
        }),
        _ => Ok(json!({})),
    }
}

fn settings_path(spec: &AgentSpec) -> Result<std::path::PathBuf, String> {
    let base = match spec.base {
        Base::Home => dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?,
        Base::Config => {
            dirs::config_dir().ok_or_else(|| "could not resolve config dir".to_string())?
        }
    };
    Ok(base.join(spec.dir).join(spec.file))
}

fn read_existing(path: &std::path::Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

fn write_atomic(path: &std::path::Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("terra-tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename into {}: {e}", path.display())
    })
}

#[tauri::command]
pub fn agent_enable_hooks(agent: String) -> Result<(), String> {
    let spec = find(&agent)?;
    let path = settings_path(spec)?;
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let existing = read_existing(&path)?;

    if let Delivery::TuiPlugin = spec.delivery {
        return match plugin_update(existing.as_deref(), &path)? {
            Some(source) => write_atomic(&path, source),
            None => Ok(()),
        };
    }

    let merged = merge_hooks(existing_config(existing.as_deref(), &path)?, spec);
    let out = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    write_atomic(&path, &out)
}

#[tauri::command]
pub fn agent_hooks_status(agent: String) -> bool {
    let Ok(spec) = find(&agent) else {
        return false;
    };
    settings_path(spec)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .is_some_and(|content| is_installed(spec, &content))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(agent: &str) -> &'static AgentSpec {
        find(agent).unwrap()
    }

    fn hook_count(root: &Value, event: &str) -> usize {
        root["hooks"][event].as_array().map_or(0, Vec::len)
    }

    fn command(root: &Value, event: &str, idx: usize) -> String {
        root["hooks"][event][idx]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn claude_adds_all_event_hooks_to_empty_config() {
        let out = merge_hooks(json!({}), spec("claude"));
        assert_eq!(hook_count(&out, "UserPromptSubmit"), 1);
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert_eq!(hook_count(&out, "Stop"), 1);
        assert!(command(&out, "Notification", 0).contains("notify;Terra;attention"));
        assert!(command(&out, "Stop", 0).contains("notify;Terra;finished"));
        assert!(command(&out, "UserPromptSubmit", 0).contains("notify;Terra;working"));
        assert!(command(&out, "Stop", 0).contains("terminalSequence"));
        assert!(!command(&out, "Stop", 0).contains("/dev/tty"));
    }

    #[test]
    fn is_idempotent_per_agent() {
        for agent in ["claude", "codex"] {
            let s = spec(agent);
            let once = merge_hooks(json!({}), s);
            let twice = merge_hooks(once.clone(), s);
            assert_eq!(once, twice, "{agent} not idempotent");
        }
    }

    #[test]
    fn codex_emits_four_field_dev_tty_marker() {
        let out = merge_hooks(json!({}), spec("codex"));
        assert_eq!(hook_count(&out, "UserPromptSubmit"), 1);
        assert_eq!(hook_count(&out, "PermissionRequest"), 1);
        assert_eq!(hook_count(&out, "Stop"), 1);
        let stop = command(&out, "Stop", 0);
        assert!(stop.contains("notify;Terra;codex;finished"));
        assert!(stop.contains("> /dev/tty"));
        // Codex Stop rejects empty/non-JSON stdout; the hook must emit a no-op.
        assert!(stop.contains("printf '{}'"));
        assert!(!stop.contains("terminalSequence"));
    }

    #[test]
    fn migrates_legacy_dev_tty_hook() {
        let legacy = json!({
            "hooks": {
                "Notification": [
                    { "hooks": [ {
                        "type": "command",
                        "command": "[ -n \"$TERRA_TERMINAL\" ] && printf '\\033]777;terra;notify\\033\\\\' > /dev/tty || true"
                    } ] }
                ]
            }
        });
        let out = merge_hooks(legacy, spec("claude"));
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert!(command(&out, "Notification", 0).contains("terminalSequence"));
        assert!(!command(&out, "Notification", 0).contains("/dev/tty"));
    }

    #[test]
    fn preserves_unrelated_settings_and_foreign_hooks() {
        let input = json!({
            "permissions": { "allow": ["Bash"] },
            "hooks": {
                "Notification": [
                    { "hooks": [ { "type": "command", "command": "say hi" } ] }
                ]
            }
        });
        let out = merge_hooks(input, spec("claude"));
        assert_eq!(out["permissions"]["allow"][0], "Bash");
        assert_eq!(hook_count(&out, "Notification"), 2);
        assert_eq!(command(&out, "Notification", 0), "say hi");
    }

    #[test]
    fn replaces_non_object_root() {
        let out = merge_hooks(json!("garbage"), spec("codex"));
        assert_eq!(hook_count(&out, "Stop"), 1);
    }

    #[test]
    fn prunes_empty_groups_and_collapses_duplicates() {
        let input = json!({
            "hooks": {
                "Notification": [
                    { "hooks": [] },
                    { "hooks": [ { "type": "command", "command": hook_command(spec("claude"), "attention") } ] }
                ]
            }
        });
        let out = merge_hooks(input, spec("claude"));
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert!(command(&out, "Notification", 0).contains("notify;Terra;attention"));
    }

    #[test]
    fn existing_config_absent_or_empty_starts_fresh() {
        let p = std::path::Path::new("/x/settings.json");
        assert_eq!(existing_config(None, p).unwrap(), json!({}));
        assert_eq!(existing_config(Some("   \n"), p).unwrap(), json!({}));
    }

    #[test]
    fn opencode_plugin_emits_every_four_field_marker_behind_the_env_gate() {
        let s = spec("opencode");
        for (_, marker) in s.events {
            assert!(OPENCODE_PLUGIN.contains(&status_needle(s, marker)), "{marker}");
        }
        assert!(OPENCODE_PLUGIN.starts_with(PLUGIN_OWNER));
        assert!(OPENCODE_PLUGIN.contains(r#"if (!process.env.TERRA_TERMINAL) return"#));
        assert!(OPENCODE_PLUGIN.contains(r#"openSync("/dev/tty", "w")"#));
        for (event, _) in s.events {
            assert!(OPENCODE_PLUGIN.contains(&format!("on(\"{event}\"")), "{event}");
        }
    }

    #[test]
    fn opencode_plugin_install_is_idempotent_and_never_clobbers_a_foreign_file() {
        let p = std::path::Path::new("/x/opencode/plugins/terra/tui.js");
        assert_eq!(plugin_update(None, p).unwrap(), Some(OPENCODE_PLUGIN));
        assert_eq!(plugin_update(Some(OPENCODE_PLUGIN), p).unwrap(), None);
        let older = format!("{PLUGIN_OWNER} an older Terra\nexport default {{}}\n");
        assert_eq!(plugin_update(Some(&older), p).unwrap(), Some(OPENCODE_PLUGIN));
        for foreign in ["", "export default { id: \"mine\" }", "// terra\n", " // terra-opencode-notify:"] {
            assert!(plugin_update(Some(foreign), p).is_err(), "{foreign:?} must be left alone");
        }
    }

    #[test]
    fn opencode_status_requires_the_current_plugin() {
        let s = spec("opencode");
        assert!(is_installed(s, OPENCODE_PLUGIN));
        assert!(!is_installed(s, &OPENCODE_PLUGIN.replace("session.idle", "session.gone")));
        // The markers alone, in a file that is not ours, do not count.
        let lookalike = "notify;Terra;opencode;working notify;Terra;opencode;attention notify;Terra;opencode;finished";
        assert!(!is_installed(s, lookalike));
        assert!(!is_installed(s, ""));
    }

    #[test]
    fn plugin_lives_under_the_config_dir_not_home() {
        let s = spec("opencode");
        let path = settings_path(s).unwrap();
        assert!(path.ends_with("opencode/plugins/terra/tui.js"));
        assert!(path.starts_with(dirs::config_dir().unwrap()));
    }

    #[test]
    fn existing_config_refuses_to_clobber_invalid_json() {
        let p = std::path::Path::new("/x/settings.json");
        assert!(existing_config(Some("{ not json,"), p).is_err());
        assert_eq!(
            existing_config(Some(r#"{"permissions":{}}"#), p).unwrap(),
            json!({ "permissions": {} })
        );
    }
}
