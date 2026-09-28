//! Reads the shell's OSC 7 cwd reports off the PTY byte stream, so the
//! workspace registry can follow a `cd` without trusting a path the webview
//! hands back. Mirrors `osc-handlers.ts`: an OSC 7 between OSC 133 B/C and the
//! next A/D is command output (a `cat`, an ssh session) and is ignored.

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;

// A cwd report is a `file://host/path` URL; anything longer is not one.
const MAX_OSC: usize = 4096;

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    Esc,
    Osc,
    OscEsc,
}

pub struct CwdDetector {
    state: State,
    payload: Vec<u8>,
    overflowed: bool,
    in_command: bool,
}

impl CwdDetector {
    pub fn new() -> Self {
        Self {
            state: State::Ground,
            payload: Vec::new(),
            overflowed: false,
            in_command: false,
        }
    }

    pub fn process(&mut self, bytes: &[u8], mut on_cwd: impl FnMut(PathBuf)) {
        for &b in bytes {
            self.step(b, &mut on_cwd);
        }
    }

    fn step(&mut self, b: u8, on_cwd: &mut impl FnMut(PathBuf)) {
        match self.state {
            State::Ground => {
                if b == 0x1b {
                    self.state = State::Esc;
                }
            }
            State::Esc => self.after_esc(b),
            State::Osc => match b {
                0x07 => self.finish(on_cwd),
                0x1b => self.state = State::OscEsc,
                _ if self.payload.len() < MAX_OSC => self.payload.push(b),
                _ => self.overflowed = true,
            },
            State::OscEsc => {
                if b == b'\\' {
                    self.finish(on_cwd);
                } else {
                    // ESC without `\` aborts the OSC and starts a new sequence.
                    self.after_esc(b);
                }
            }
        }
    }

    fn after_esc(&mut self, b: u8) {
        self.state = match b {
            b']' => {
                self.payload.clear();
                self.overflowed = false;
                State::Osc
            }
            0x1b => State::Esc,
            _ => State::Ground,
        };
    }

    fn finish(&mut self, on_cwd: &mut impl FnMut(PathBuf)) {
        self.state = State::Ground;
        if self.overflowed {
            return;
        }
        if let Some(mark) = self.payload.strip_prefix(b"133;") {
            match mark.first() {
                Some(b'A' | b'D') => self.in_command = false,
                Some(b'B' | b'C') => self.in_command = true,
                _ => {}
            }
        } else if let Some(url) = self.payload.strip_prefix(b"7;") {
            if !self.in_command {
                if let Some(path) = parse_file_url(url) {
                    on_cwd(path);
                }
            }
        }
    }
}

/// `file://<host>/<percent-encoded path>` to an absolute path. The host is
/// not trusted here; the caller only grants a path that matches a live cwd.
fn parse_file_url(url: &[u8]) -> Option<PathBuf> {
    let rest = url.strip_prefix(b"file://")?;
    let path = &rest[rest.iter().position(|&b| b == b'/')?..];
    let mut out = Vec::with_capacity(path.len());
    let mut i = 0;
    while i < path.len() {
        let b = path[i];
        if b == b'%' {
            let hex = path.get(i + 1..i + 3)?;
            let hex = std::str::from_utf8(hex).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b);
            i += 1;
        }
    }
    if out.contains(&0) {
        return None;
    }
    Some(PathBuf::from(OsString::from_vec(out)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(d: &mut CwdDetector, chunks: &[&[u8]]) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for chunk in chunks {
            d.process(chunk, |p| out.push(p));
        }
        out
    }

    #[test]
    fn reports_a_cwd_with_either_terminator() {
        let mut d = CwdDetector::new();
        let got = feed(
            &mut d,
            &[b"\x1b]7;file://host/tmp/a\x1b\\", b"\x1b]7;file:///tmp/b\x07"],
        );
        assert_eq!(got, [PathBuf::from("/tmp/a"), PathBuf::from("/tmp/b")]);
    }

    #[test]
    fn survives_a_report_split_across_reads() {
        let mut d = CwdDetector::new();
        let got = feed(&mut d, &[b"out\x1b", b"]7;file://h/ho", b"me/u\x1b", b"\\"]);
        assert_eq!(got, [PathBuf::from("/home/u")]);
    }

    #[test]
    fn decodes_percent_escapes_byte_wise() {
        let mut d = CwdDetector::new();
        let got = feed(&mut d, &[b"\x1b]7;file://h/tmp/a%20b/%C3%A9\x07"]);
        assert_eq!(got, [PathBuf::from("/tmp/a b/\u{e9}")]);
    }

    // Command output is untrusted: a `cat` of a crafted file or a remote shell
    // must not move the registry.
    #[test]
    fn ignores_a_report_while_a_command_runs() {
        let mut d = CwdDetector::new();
        let got = feed(
            &mut d,
            &[
                b"\x1b]133;C;cat evil\x1b\\",
                b"\x1b]7;file:///\x1b\\",
                b"\x1b]133;D;0\x1b\\",
                b"\x1b]7;file:///home/u\x1b\\",
                b"\x1b]133;A\x1b\\\x1b]133;B\x1b\\",
                b"\x1b]7;file:///etc\x1b\\",
            ],
        );
        assert_eq!(got, [PathBuf::from("/home/u")]);
    }

    #[test]
    fn refuses_malformed_and_oversized_reports() {
        let mut d = CwdDetector::new();
        let mut huge = b"\x1b]7;file:///".to_vec();
        huge.extend(std::iter::repeat_n(b'a', MAX_OSC + 10));
        huge.extend_from_slice(b"\x07");
        let got = feed(
            &mut d,
            &[
                b"\x1b]7;http://h/tmp\x07",
                b"\x1b]7;file://no-path\x07",
                b"\x1b]7;file:///tmp/%zz\x07",
                b"\x1b]7;file:///tmp/%00x\x07",
                &huge,
                b"\x1b]7;file:///ok\x07",
            ],
        );
        assert_eq!(got, [PathBuf::from("/ok")]);
    }

    #[test]
    fn an_interrupted_sequence_does_not_leak_into_the_next() {
        let mut d = CwdDetector::new();
        let got = feed(&mut d, &[b"\x1b]7;file:///tmp\x1b[0m\x1b]7;file:///srv\x07"]);
        assert_eq!(got, [PathBuf::from("/srv")]);
    }
}
