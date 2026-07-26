const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const LBRACKET: u8 = 0x5b;
const RBRACKET: u8 = 0x5d;
const BACKSLASH: u8 = 0x5c;

// Matches da_filter's HOLD_MAX discipline: a candidate that never terminates is
// discarded rather than grown without bound.
const CAND_MAX: usize = 2048;

/// Payload for the `terra:dev-server` event. `id` is the pty id, matching how
/// `AgentSignal` identifies its session.
#[derive(Clone, serde::Serialize)]
pub struct DevServerSignal {
    pub id: u32,
    pub url: String,
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    /// Accumulating (or ignoring) ordinary bytes.
    Ground,
    /// Saw ESC; the next byte decides which sequence form this is.
    Esc,
    /// Inside `ESC [ ... final`, where final is 0x40..=0x7e.
    Csi,
    /// Inside `ESC ] ... BEL` or `ESC ] ... ESC \`.
    Osc,
    /// Saw ESC while inside an OSC; `\` ends the stringterminator form.
    OscEsc,
}

/// Scans raw PTY output for loopback dev-server URLs.
///
/// Unlike `AgentDetector`, this reads ordinary output rather than OSC markers,
/// so it carries its own noise discipline: an escape sequence closes the
/// current candidate, and the last emitted URL is remembered so a repainting
/// TUI does not flood IPC. All further policy (per-session dedup, dismissal)
/// belongs to the frontend.
pub struct UrlDetector {
    state: State,
    cand: Vec<u8>,
    /// Set when the candidate overflowed CAND_MAX: keep consuming until the
    /// terminator, but do not evaluate.
    poisoned: bool,
    last: Option<String>,
}

impl UrlDetector {
    pub fn new() -> Self {
        UrlDetector {
            state: State::Ground,
            cand: Vec::with_capacity(64),
            poisoned: false,
            last: None,
        }
    }

    pub fn process<F: FnMut(&str)>(&mut self, input: &[u8], mut emit: F) {
        for &b in input {
            match self.state {
                State::Ground => {
                    if b == ESC {
                        self.flush(&mut emit);
                        self.state = State::Esc;
                    } else if is_url_byte(b) {
                        if self.cand.len() >= CAND_MAX {
                            self.poisoned = true;
                            self.cand.clear();
                        }
                        if !self.poisoned {
                            self.cand.push(b);
                        }
                    } else {
                        self.flush(&mut emit);
                    }
                }
                State::Esc => match b {
                    LBRACKET => self.state = State::Csi,
                    RBRACKET => self.state = State::Osc,
                    ESC => {}
                    _ => self.state = State::Ground,
                },
                State::Csi => {
                    if (0x40..=0x7e).contains(&b) {
                        self.state = State::Ground;
                    }
                }
                State::Osc => match b {
                    BEL => self.state = State::Ground,
                    ESC => self.state = State::OscEsc,
                    _ => {}
                },
                State::OscEsc => match b {
                    BACKSLASH => self.state = State::Ground,
                    ESC => {}
                    _ => self.state = State::Osc,
                },
            }
        }
    }

    /// Evaluate and clear the pending candidate. A candidate still open when a
    /// chunk ends stays pending, so a URL split across reads still matches.
    fn flush<F: FnMut(&str)>(&mut self, emit: &mut F) {
        let poisoned = std::mem::replace(&mut self.poisoned, false);
        let cand = std::mem::take(&mut self.cand);
        if poisoned || cand.is_empty() {
            return;
        }
        let Some(url) = normalize(&cand) else {
            return;
        };
        if self.last.as_deref() == Some(url.as_str()) {
            return;
        }
        emit(&url);
        self.last = Some(url);
    }
}

/// Bytes allowed inside a candidate. Square brackets are included because the
/// `[::1]` literal needs them; quotes, parens and angle brackets are excluded
/// so prose wrapping a URL terminates it.
fn is_url_byte(b: u8) -> bool {
    matches!(b,
        b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9'
        | b'-' | b'.' | b'_' | b'~' | b':' | b'/' | b'?' | b'#'
        | b'[' | b']' | b'@' | b'!' | b'$' | b'&' | b'*' | b'+'
        | b',' | b';' | b'=' | b'%'
    )
}

/// Returns the normalized URL if `cand` is a loopback dev-server URL.
fn normalize(cand: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(cand).ok()?;
    let (scheme, rest) = if let Some(r) = s.strip_prefix("http://") {
        ("http://", r)
    } else {
        ("https://", s.strip_prefix("https://")?)
    };

    // Split host from the ":port[/path]" tail. IPv6 literals carry their own
    // brackets, so scan past the closing bracket before looking for the colon.
    let (host, after_host) = if let Some(tail) = rest.strip_prefix('[') {
        let close = tail.find(']')?;
        (&rest[..close + 2], &tail[close + 1..])
    } else {
        let end = rest.find([':', '/'])?;
        (&rest[..end], &rest[end..])
    };

    let host_out = match host {
        "localhost" | "127.0.0.1" | "[::1]" => host,
        // Servers print 0.0.0.0 to mean "all interfaces"; it will not load in
        // an iframe, so offer the loopback name instead.
        "0.0.0.0" => "localhost",
        _ => return None,
    };

    let port_and_path = after_host.strip_prefix(':')?;
    let digits_end = port_and_path
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(port_and_path.len());
    let digits = &port_and_path[..digits_end];
    if digits.is_empty() || digits.len() > 5 {
        return None;
    }
    let port: u32 = digits.parse().ok()?;
    if !(1..=65535).contains(&port) {
        return None;
    }

    let path = &port_and_path[digits_end..];
    if !path.is_empty() && !path.starts_with(['/', '?', '#']) {
        return None;
    }

    Some(format!("{scheme}{host_out}:{port}{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(d: &mut UrlDetector, input: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        d.process(input, |u| out.push(u.to_string()));
        out
    }

    #[test]
    fn plain_localhost_match() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://localhost:5173\n"), vec!["http://localhost:5173"]);
    }

    #[test]
    fn colour_wrapped_url_matches() {
        let mut d = UrlDetector::new();
        let input = b"  \x1b[32m\xe2\x9e\x9c\x1b[39m  Local:   \x1b[36mhttp://localhost:5173/\x1b[39m\r\n";
        assert_eq!(run(&mut d, input), vec!["http://localhost:5173/"]);
    }

    #[test]
    fn split_across_chunks() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://localh").is_empty());
        assert_eq!(run(&mut d, b"ost:5173\n"), vec!["http://localhost:5173"]);
    }

    #[test]
    fn loopback_ipv4_and_path() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://127.0.0.1:8000/docs "), vec!["http://127.0.0.1:8000/docs"]);
    }

    #[test]
    fn https_matches() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"https://localhost:3000\n"), vec!["https://localhost:3000"]);
    }

    #[test]
    fn ipv6_literal_matches() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://[::1]:4321\n"), vec!["http://[::1]:4321"]);
    }

    #[test]
    fn wildcard_host_rewritten_to_localhost() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://0.0.0.0:8080/\n"), vec!["http://localhost:8080/"]);
    }

    #[test]
    fn bare_host_without_scheme_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"localhost:5173\n").is_empty());
    }

    #[test]
    fn lan_address_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://192.168.1.5:5173\n").is_empty());
    }

    #[test]
    fn missing_port_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://localhost\n").is_empty());
    }

    #[test]
    fn port_out_of_range_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://localhost:99999\n").is_empty());
    }

    #[test]
    fn non_loopback_host_skipped() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://example.com:80\n").is_empty());
    }

    #[test]
    fn repeat_collapsed_in_one_chunk() {
        let mut d = UrlDetector::new();
        let out = run(&mut d, b"http://localhost:5173\nhttp://localhost:5173\n");
        assert_eq!(out, vec!["http://localhost:5173"]);
    }

    #[test]
    fn repeat_collapsed_across_chunks() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://localhost:5173\n"), vec!["http://localhost:5173"]);
        assert!(run(&mut d, b"http://localhost:5173\n").is_empty());
    }

    #[test]
    fn different_url_after_repeat_emits() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"http://localhost:5173\n"), vec!["http://localhost:5173"]);
        assert_eq!(run(&mut d, b"http://localhost:6006\n"), vec!["http://localhost:6006"]);
        assert_eq!(run(&mut d, b"http://localhost:5173\n"), vec!["http://localhost:5173"]);
    }

    #[test]
    fn runaway_candidate_discarded_at_cap() {
        let mut d = UrlDetector::new();
        let mut input = Vec::from(b"http://localhost:5173/".as_slice());
        input.extend(std::iter::repeat_n(b'a', CAND_MAX + 10));
        input.push(b'\n');
        assert!(run(&mut d, &input).is_empty());
    }

    #[test]
    fn candidate_open_at_end_of_chunk_is_not_emitted() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"http://localhost:5173").is_empty());
    }

    #[test]
    fn quotes_and_parens_terminate() {
        let mut d = UrlDetector::new();
        assert_eq!(run(&mut d, b"(http://localhost:5173)"), vec!["http://localhost:5173"]);
    }

    #[test]
    fn osc_sequence_does_not_leak_into_candidate() {
        let mut d = UrlDetector::new();
        let input = b"\x1b]0;title\x07http://localhost:5173\n";
        assert_eq!(run(&mut d, input), vec!["http://localhost:5173"]);
    }

    #[test]
    fn plain_text_emits_nothing() {
        let mut d = UrlDetector::new();
        assert!(run(&mut d, b"hello world\nno urls here\n").is_empty());
    }
}
