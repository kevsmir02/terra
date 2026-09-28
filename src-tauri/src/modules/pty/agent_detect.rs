const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';

const OSC_MAX: usize = 2048;

const DEFAULT_AGENTS: &[&str] = &["claude", "codex", "opencode"];

// Extra agent names arrive from the webview and end up matched against every
// command line a shell runs, so they are held to a plain command-name shape.
pub const MAX_EXTRA_AGENTS: usize = 16;
pub const MAX_AGENT_NAME_LEN: usize = 32;

// OSC 777 markers our agent hooks emit. Legacy 3-field `notify;Terra;<event>`
// (Claude) or 4-field `notify;Terra;<agent>;<event>` (Codex).
//
// `notify;Terax;` is the pre-rename spelling. Hooks live in the user's own
// agent config (~/.claude/settings.json and friends), so installs predating
// the rename keep emitting it until they're reinstalled from Settings,
// accept both spellings rather than silently dropping their notifications.
const MARKERS: [&[u8]; 2] = [b"notify;Terra;", b"notify;Terax;"];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,
    Esc,
    Osc,
    OscEsc,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Status {
    Working,
    Waiting,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Transition {
    Started { agent: String },
    Working,
    Attention,
    Finished,
    Exited { code: Option<i32> },
}

#[derive(Clone, serde::Serialize)]
pub struct AgentSignal {
    pub id: u32,
    pub kind: &'static str,
    pub agent: Option<String>,
    pub code: Option<i32>,
}

impl Transition {
    pub fn into_signal(self, id: u32) -> AgentSignal {
        let (kind, agent, code) = match self {
            Transition::Started { agent } => ("started", Some(agent), None),
            Transition::Working => ("working", None, None),
            Transition::Attention => ("attention", None, None),
            Transition::Finished => ("finished", None, None),
            Transition::Exited { code } => ("exited", None, code),
        };
        AgentSignal { id, kind, agent, code }
    }
}

/// A bare command name: ASCII alphanumeric first, then alphanumerics, `-`, `_`
/// or `.`. No path, no whitespace, nothing that reads as a flag.
pub fn is_safe_agent_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_AGENT_NAME_LEN
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// The detector's agent list: the built-in names plus the user's extras that
/// pass `is_safe_agent_name`, deduplicated and capped. Invalid entries are
/// dropped rather than failing the spawn, so a bad setting never costs a shell.
pub fn detector_agents(extra: Option<Vec<String>>) -> Vec<String> {
    let mut agents: Vec<String> = DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect();
    let mut added = 0;
    for name in extra.unwrap_or_default() {
        if added == MAX_EXTRA_AGENTS {
            break;
        }
        if !is_safe_agent_name(&name) {
            log::warn!("ignoring an agent command name that is not a plain command");
            continue;
        }
        if agents.contains(&name) {
            continue;
        }
        agents.push(name);
        added += 1;
    }
    agents
}

// `D;<code>[;...]` from OSC 133; a bare `D` carries no code.
fn exit_code(pt: &[u8]) -> Option<i32> {
    let rest = pt.strip_prefix(b"D;")?;
    let end = rest.iter().position(|&c| c == b';').unwrap_or(rest.len());
    std::str::from_utf8(&rest[..end]).ok()?.parse().ok()
}

pub struct AgentDetector {
    agents: Vec<String>,
    state: State,
    osc: Vec<u8>,
    armed: bool,
    status: Status,
}

impl AgentDetector {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::with_agents(detector_agents(None))
    }

    pub fn with_agents(agents: Vec<String>) -> Self {
        Self {
            agents,
            state: State::Ground,
            osc: Vec::new(),
            armed: false,
            status: Status::Working,
        }
    }

    /// Feed a chunk of raw PTY output. Transitions come only from OSC sequences
    /// (`133` prompt boundaries, our `777` hook marker), never from raw output,
    /// so a TUI agent that repaints continuously never flaps working/waiting.
    pub fn process<F: FnMut(Transition)>(&mut self, input: &[u8], mut emit: F) {
        if self.state == State::Ground && !input.contains(&ESC) {
            return;
        }

        for &b in input {
            match self.state {
                State::Ground => {
                    if b == ESC {
                        self.state = State::Esc;
                    }
                }
                State::Esc => match b {
                    OSC_INTRO => {
                        self.state = State::Osc;
                        self.osc.clear();
                    }
                    ESC => {}
                    _ => self.state = State::Ground,
                },
                State::Osc => match b {
                    BEL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => self.state = State::OscEsc,
                    _ => {
                        if self.osc.len() < OSC_MAX {
                            self.osc.push(b);
                        } else {
                            self.osc.clear();
                            self.state = State::Ground;
                        }
                    }
                },
                State::OscEsc => match b {
                    ST_FINAL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => {}
                    _ => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                },
            }
        }
    }

    /// Called when the underlying PTY closes. Reports the agent as exited so the
    /// UI doesn't leave a stale entry if the shell died mid-command.
    pub fn finish<F: FnMut(Transition)>(&mut self, mut emit: F) {
        if self.armed {
            self.disarm();
            emit(Transition::Exited { code: None });
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.status = Status::Working;
    }

    fn finish_osc<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        let body = std::mem::take(&mut self.osc);
        let (ps, pt) = match body.iter().position(|&c| c == b';') {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (&body[..], &body[0..0]),
        };
        match ps {
            b"133" => self.handle_osc133(pt, emit),
            // OSC 9;4 is taskbar progress, not a notification.
            b"9" if !pt.starts_with(b"4;") && pt != b"4" => self.generic_attention(emit),
            b"777" => self.handle_osc777(pt, emit),
            _ => {}
        }
    }

    fn handle_osc777<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        let marker_tail = MARKERS.iter().find_map(|m| pt.strip_prefix(*m));
        if let Some(tail) = marker_tail {
            // PTY output is untrusted: only self-arm for known agents.
            let (agent, event) = match tail.iter().position(|&c| c == b';') {
                Some(i) => {
                    let Ok(name) = std::str::from_utf8(&tail[..i]) else {
                        return;
                    };
                    if !self.agents.iter().any(|a| a == name) {
                        return;
                    }
                    (name, &tail[i + 1..])
                }
                None => ("claude", tail),
            };
            // Self-arms when no shell preexec fired (bash, Windows, tmux).
            match event {
                b"working" => {
                    self.ensure_armed(agent, emit);
                    self.set_working(emit);
                }
                b"attention" => {
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Attention);
                }
                b"finished" => {
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Finished);
                }
                _ => {}
            }
            return;
        }
        self.generic_attention(emit);
    }

    fn handle_osc133<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        match pt.first() {
            Some(b'C') => {
                if self.armed {
                    return;
                }
                let cmd = pt.strip_prefix(b"C;").unwrap_or(b"");
                if let Some(agent) = self.match_agent(cmd) {
                    self.armed = true;
                    self.status = Status::Working;
                    emit(Transition::Started { agent });
                }
            }
            Some(b'D') if self.armed => {
                self.disarm();
                emit(Transition::Exited { code: exit_code(pt) });
            }
            _ => {}
        }
    }

    fn ensure_armed<F: FnMut(Transition)>(&mut self, agent: &str, emit: &mut F) {
        if !self.armed {
            self.armed = true;
            self.status = Status::Working;
            emit(Transition::Started { agent: agent.to_string() });
        }
    }

    fn set_working<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.status != Status::Working {
            self.status = Status::Working;
            emit(Transition::Working);
        }
    }

    fn generic_attention<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.armed {
            self.status = Status::Waiting;
            emit(Transition::Attention);
        }
    }

    fn match_agent(&self, cmd: &[u8]) -> Option<String> {
        let cmd = std::str::from_utf8(cmd).ok()?;
        for token in cmd.split_whitespace() {
            if token.starts_with('-') {
                continue;
            }
            let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
            if let Some(agent) = self.agents.iter().find(|a| {
                base.strip_prefix(a.as_str())
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
            }) {
                return Some(agent.clone());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(d: &mut AgentDetector, input: &[u8]) -> Vec<Transition> {
        let mut out = Vec::new();
        d.process(input, |t| out.push(t));
        out
    }

    fn osc(body: &str) -> Vec<u8> {
        let mut v = vec![ESC, OSC_INTRO];
        v.extend_from_slice(body.as_bytes());
        v.extend_from_slice(&[ESC, ST_FINAL]);
        v
    }

    fn started(agent: &str) -> Transition {
        Transition::Started { agent: agent.into() }
    }

    #[test]
    fn arms_on_agent_command() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;claude -p hello")), vec![started("claude")]);
    }

    #[test]
    fn arms_on_opencode_command() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;opencode")), vec![started("opencode")]);
    }

    #[test]
    fn arms_on_pathed_and_wrapped_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;/usr/local/bin/codex exec")),
            vec![started("codex")]
        );
        let mut d2 = AgentDetector::new();
        assert_eq!(run(&mut d2, &osc("133;C;npx claude")), vec![started("claude")]);
    }

    #[test]
    fn arms_on_dash_suffixed_alias() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;claude-enigma")), vec![started("claude")]);
    }

    #[test]
    fn does_not_arm_on_other_commands() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("133;C;vim src/main.rs")).is_empty());
        assert!(run(&mut d, &osc("133;C;cat claude.txt")).is_empty());
        assert!(run(&mut d, &osc("133;C;claudexyz")).is_empty());
    }

    #[test]
    fn ignores_bell_and_plain_output() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert!(run(&mut d, &[BEL]).is_empty());
        assert!(run(&mut d, b"thinking...\x07more").is_empty());
    }

    #[test]
    fn terra_marker_drives_status() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("777;notify;Terra;attention")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("777;notify;Terra;working")), vec![Transition::Working]);
        assert!(run(&mut d, &osc("777;notify;Terra;working")).is_empty());
        assert_eq!(run(&mut d, &osc("777;notify;Terra;finished")), vec![Transition::Finished]);
    }

    #[test]
    fn legacy_terax_marker_still_drives_status() {
        // Hooks installed before the rename live in the user's agent config
        // and keep emitting the old spelling until they're reinstalled.
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("777;notify;Terax;attention")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("777;notify;Terax;working")), vec![Transition::Working]);
        assert_eq!(run(&mut d, &osc("777;notify;Terax;finished")), vec![Transition::Finished]);

        // The 4-field form self-arms for a named agent just as the new one does.
        let mut c = AgentDetector::new();
        assert_eq!(run(&mut c, &osc("777;notify;Terax;codex;working")), vec![started("codex")]);
    }

    #[test]
    fn terra_marker_auto_arms_without_preexec() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terra;attention")),
            vec![started("claude"), Transition::Attention]
        );
    }

    #[test]
    fn four_field_marker_self_arms_named_agent() {
        // Fresh arm already implies Working, so `working` emits only Started.
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("777;notify;Terra;codex;working")), vec![started("codex")]);
        let mut g = AgentDetector::new();
        assert_eq!(
            run(&mut g, &osc("777;notify;Terra;codex;finished")),
            vec![started("codex"), Transition::Finished]
        );
    }

    #[test]
    fn four_field_marker_ignores_unknown_agent() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Terra;evil;attention")).is_empty());
        // A known agent in the same chunk still works.
        assert_eq!(
            run(&mut d, &osc("777;notify;Terra;codex;attention")),
            vec![started("codex"), Transition::Attention]
        );
    }

    #[test]
    fn four_field_marker_drives_status_after_preexec() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("777;notify;Terra;codex;attention")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("777;notify;Terra;codex;working")), vec![Transition::Working]);
        assert_eq!(run(&mut d, &osc("777;notify;Terra;codex;finished")), vec![Transition::Finished]);
    }

    #[test]
    fn generic_osc777_and_osc9_attention_only_when_armed() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Other;ready")).is_empty());
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("777;notify;Codex;ready")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("9;needs you")), vec![Transition::Attention]);
        assert!(run(&mut d, &osc("9;4;1;50")).is_empty());
    }

    #[test]
    fn exits_on_133d() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("133;D;0")), vec![Transition::Exited { code: Some(0) }]);
        assert!(run(&mut d, &osc("133;D;0")).is_empty());
    }

    #[test]
    fn exit_carries_the_command_status_only_when_well_formed() {
        for (body, code) in [("133;D;130", Some(130)), ("133;D", None), ("133;D;x9", None), ("133;D;1;aid=4", Some(1))] {
            let mut d = AgentDetector::new();
            run(&mut d, &osc("133;C;codex"));
            assert_eq!(run(&mut d, &osc(body)), vec![Transition::Exited { code }], "{body}");
        }
    }

    #[test]
    fn safe_agent_names_are_plain_command_names() {
        for ok in ["gemini", "cursor-agent", "qwen", "amp", "aider.v2", "a_b", "X1"] {
            assert!(is_safe_agent_name(ok), "{ok} should pass");
        }
        assert!(is_safe_agent_name(&"a".repeat(MAX_AGENT_NAME_LEN)));
        let long = "a".repeat(MAX_AGENT_NAME_LEN + 1);
        for bad in ["", "-rf", ".hidden", "_x", "a b", "a/b", "../x", "a;b", "a$b", "a\u{7}", "\u{e9}t\u{e9}", &long] {
            assert!(!is_safe_agent_name(bad), "{bad:?} should be refused");
        }
    }

    #[test]
    fn detector_agents_drops_unsafe_duplicate_and_excess_extras() {
        assert_eq!(detector_agents(None), vec!["claude", "codex", "opencode"]);
        let extra = ["gemini", "-evil", "claude", "gemini", "a b"].map(String::from).to_vec();
        assert_eq!(detector_agents(Some(extra)), vec!["claude", "codex", "opencode", "gemini"]);
        let many: Vec<String> = (0..MAX_EXTRA_AGENTS + 5).map(|i| format!("agent{i}")).collect();
        assert_eq!(detector_agents(Some(many)).len(), DEFAULT_AGENTS.len() + MAX_EXTRA_AGENTS);
    }

    #[test]
    fn arms_on_a_configured_extra_agent_only() {
        let extra = || AgentDetector::with_agents(detector_agents(Some(vec!["gemini".into()])));
        assert_eq!(run(&mut extra(), &osc("133;C;gemini -p hi")), vec![started("gemini")]);
        assert_eq!(
            run(&mut extra(), &osc("777;notify;Terra;gemini;attention")),
            vec![started("gemini"), Transition::Attention]
        );
        let mut plain = AgentDetector::new();
        assert!(run(&mut plain, &osc("133;C;gemini -p hi")).is_empty());
        assert!(run(&mut plain, &osc("777;notify;Terra;gemini;attention")).is_empty());
    }

    #[test]
    fn bel_terminator_inside_osc_is_not_attention() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend_from_slice(b"0;set title");
        seq.push(BEL);
        assert!(run(&mut d, &seq).is_empty());
    }

    #[test]
    fn started_split_across_chunks() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &[ESC, OSC_INTRO]).is_empty());
        assert!(run(&mut d, b"133;C;cla").is_empty());
        let mut out = run(&mut d, b"ude");
        out.extend(run(&mut d, &[ESC, ST_FINAL]));
        assert_eq!(out, vec![started("claude")]);
    }

    #[test]
    fn finish_reports_exited_when_armed() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut out = Vec::new();
        d.finish(|t| out.push(t));
        assert_eq!(out, vec![Transition::Exited { code: None }]);
        let mut out2 = Vec::new();
        d.finish(|t| out2.push(t));
        assert!(out2.is_empty());
    }

    #[test]
    fn oversized_osc_does_not_panic() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend(std::iter::repeat_n(b'x', OSC_MAX + 100));
        seq.extend_from_slice(&[ESC, ST_FINAL]);
        assert!(run(&mut d, &seq).is_empty());
        assert_eq!(run(&mut d, &osc("777;notify;Terra;attention")), vec![Transition::Attention]);
    }
}
