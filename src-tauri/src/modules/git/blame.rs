use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::PathBuf;

use serde::Serialize;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::process::{ensure_git_available, ensure_success, git_stdout_line_opt, run_git};
use crate::modules::git::utils::{canonical_dir, display_path};
use crate::modules::workspace::WorkspaceRegistry;

/// Mirrors the editor's SYNTAX_MAX_BYTES: above it highlighting and LSP are
/// off, and blame is too.
pub const BLAME_MAX_BYTES: u64 = 4 * 1024 * 1024;
pub const BLAME_MAX_LINES: u32 = 100_000;
const BLAME_TIMEOUT_SECS: u64 = 20;
const UNCOMMITTED_SHA_CHAR: char = '0';

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameCommit {
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub summary: String,
    /// The blamed file's repo-relative name in this commit.
    pub filename: String,
    pub previous_sha: Option<String>,
    pub previous_filename: Option<String>,
    pub boundary: bool,
    pub uncommitted: bool,
}

/// `count` lines from 1-based `start` belong to `commits[commit]`.
#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
pub struct GitBlameHunk {
    pub start: u32,
    pub count: u32,
    pub commit: u32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitBlame {
    #[serde(rename_all = "camelCase")]
    Ready {
        repo_root: String,
        commits: Vec<GitBlameCommit>,
        hunks: Vec<GitBlameHunk>,
    },
    /// Git has no history for the file: every line is uncommitted.
    Untracked,
    TooLarge,
    NotInRepo,
}

pub struct ParsedBlame {
    pub commits: Vec<GitBlameCommit>,
    pub hunks: Vec<GitBlameHunk>,
}

fn is_object_id(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn parse_group_header(line: &str) -> Option<(&str, u32, u32)> {
    let mut parts = line.split(' ');
    let sha = parts.next()?;
    if !is_object_id(sha) {
        return None;
    }
    let _source_line: u32 = parts.next()?.parse().ok()?;
    let start: u32 = parts.next()?.parse().ok()?;
    let count: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || start == 0 || count == 0 {
        return None;
    }
    Some((sha, start, count))
}

/// Git C-quotes a path holding a quote, backslash, control or (with the
/// default core.quotePath) non-ASCII byte; spaces stay bare.
pub fn unquote_path(raw: &str) -> String {
    let Some(inner) = raw
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    else {
        return raw.to_string();
    };
    let bytes = inner.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'\\' || i + 1 == bytes.len() {
            out.push(bytes[i]);
            i += 1;
            continue;
        }
        let next = bytes[i + 1];
        let octal = bytes
            .get(i + 1..i + 4)
            .filter(|d| d.iter().all(|b| (b'0'..=b'7').contains(b)));
        if let Some(digits) = octal {
            let value = digits
                .iter()
                .fold(0u32, |acc, d| acc * 8 + u32::from(d - b'0'));
            out.push(value as u8);
            i += 4;
            continue;
        }
        out.push(match next {
            b'n' => b'\n',
            b't' => b'\t',
            b'r' => b'\r',
            b'a' => 0x07,
            b'b' => 0x08,
            b'f' => 0x0c,
            b'v' => 0x0b,
            other => other,
        });
        i += 2;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parses `git blame --incremental`. Groups arrive in discovery order, each
/// commit's metadata only on its first group, and every group ends with its
/// `filename` line; anything malformed is skipped rather than trusted.
pub fn parse_incremental(text: &str, line_count: u32) -> ParsedBlame {
    let mut commits: Vec<GitBlameCommit> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut hunks: Vec<GitBlameHunk> = Vec::new();
    let mut open: Option<(usize, u32, u32)> = None;

    for line in text.lines() {
        let Some((commit_ix, start, count)) = open else {
            if let Some((sha, start, count)) = parse_group_header(line) {
                let ix = *index.entry(sha.to_string()).or_insert_with(|| {
                    commits.push(GitBlameCommit {
                        sha: sha.to_string(),
                        short_sha: sha.chars().take(7).collect(),
                        author: String::new(),
                        author_email: String::new(),
                        author_time: 0,
                        summary: String::new(),
                        filename: String::new(),
                        previous_sha: None,
                        previous_filename: None,
                        boundary: false,
                        uncommitted: sha.chars().all(|c| c == UNCOMMITTED_SHA_CHAR),
                    });
                    commits.len() - 1
                });
                open = Some((ix, start, count));
            }
            continue;
        };
        let commit = &mut commits[commit_ix];
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "filename" => {
                if commit.filename.is_empty() {
                    commit.filename = unquote_path(value);
                }
                hunks.push(GitBlameHunk {
                    start,
                    count,
                    commit: commit_ix as u32,
                });
                open = None;
            }
            "author" => commit.author = value.to_string(),
            "author-mail" => {
                commit.author_email = value
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .to_string()
            }
            "author-time" => commit.author_time = value.parse().unwrap_or(0),
            "summary" => commit.summary = value.to_string(),
            "boundary" => commit.boundary = true,
            "previous" => {
                if let Some((sha, name)) = value.split_once(' ') {
                    if is_object_id(sha) {
                        commit.previous_sha = Some(sha.to_string());
                        commit.previous_filename = Some(unquote_path(name));
                    }
                }
            }
            _ => {}
        }
    }

    hunks.sort_by_key(|h| h.start);
    let mut merged: Vec<GitBlameHunk> = Vec::with_capacity(hunks.len());
    for hunk in hunks {
        let end = hunk.start.saturating_add(hunk.count);
        if hunk.start > line_count || end > line_count.saturating_add(1) {
            continue;
        }
        match merged.last_mut() {
            Some(prev) if hunk.start < prev.start + prev.count => continue,
            Some(prev) if prev.commit == hunk.commit && prev.start + prev.count == hunk.start => {
                prev.count += hunk.count;
            }
            _ => merged.push(hunk),
        }
    }
    ParsedBlame {
        commits,
        hunks: merged,
    }
}

fn line_count(bytes: &[u8]) -> u32 {
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count();
    let trailing = usize::from(bytes.last().is_some_and(|&b| b != b'\n'));
    u32::try_from(newlines + trailing).unwrap_or(u32::MAX)
}

fn no_history(stderr: &[u8]) -> bool {
    let stderr = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    stderr.contains("no such path")
        || stderr.contains("no such ref")
        || stderr.contains("does not have any commits yet")
        || stderr.contains("bad revision")
}

/// Blames the file as it is on disk, for the one absolute `path` the editor
/// has open. The file itself must be inside a workspace root; the repository
/// root is only read, never granted.
pub fn blame(registry: &WorkspaceRegistry, path: &str) -> Result<GitBlame> {
    let requested = PathBuf::from(path);
    if !requested.is_absolute() {
        return Err(GitError::InvalidPath(path.to_string()));
    }
    let file = registry
        .canonicalize_cached(&requested)
        .map_err(GitError::Io)?;
    if !registry.is_authorized(&file) {
        return Err(GitError::PathOutsideWorkspace(file));
    }
    let meta = std::fs::metadata(&file)?;
    if !meta.is_file() {
        return Err(GitError::InvalidPath(path.to_string()));
    }
    if meta.len() > BLAME_MAX_BYTES {
        return Ok(GitBlame::TooLarge);
    }
    let Some(dir) = file.parent() else {
        return Err(GitError::InvalidPath(path.to_string()));
    };
    ensure_git_available()?;
    let Some(top) = git_stdout_line_opt(&display_path(dir), ["rev-parse", "--show-toplevel"])?
    else {
        return Ok(GitBlame::NotInRepo);
    };
    let root = canonical_dir(registry, &top)?;
    let Ok(rel) = file.strip_prefix(&root.local_path) else {
        return Ok(GitBlame::NotInRepo);
    };
    let rel = rel.to_string_lossy().into_owned();
    let lines = line_count(&std::fs::read(&file)?);
    if lines > BLAME_MAX_LINES {
        return Ok(GitBlame::TooLarge);
    }
    let output = run_git(
        Some(&root.git_path),
        [
            OsStr::new("blame"),
            OsStr::new("--incremental"),
            OsStr::new("--"),
            OsStr::new(&rel),
        ],
        BLAME_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git blame"));
    }
    if output.exit_code != Some(0) {
        if no_history(&output.stderr) {
            return Ok(GitBlame::Untracked);
        }
        ensure_success(&output, "git blame failed")?;
    }
    // A partial blame would leave the tail of the file unattributed as if it
    // were uncommitted, so an oversized one is refused whole.
    if output.truncated {
        return Ok(GitBlame::TooLarge);
    }
    let parsed = parse_incremental(&String::from_utf8_lossy(&output.stdout), lines);
    Ok(GitBlame::Ready {
        repo_root: root.git_path,
        commits: parsed.commits,
        hunks: parsed.hunks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "1111111111111111111111111111111111111111";
    const B: &str = "2222222222222222222222222222222222222222";
    const ZERO: &str = "0000000000000000000000000000000000000000";

    fn group(sha: &str, start: u32, count: u32, meta: &[&str], filename: &str) -> String {
        let mut out = format!("{sha} {start} {start} {count}\n");
        for line in meta {
            out.push_str(line);
            out.push('\n');
        }
        out.push_str(&format!("filename {filename}\n"));
        out
    }

    fn meta(author: &str, summary: &str) -> Vec<String> {
        vec![
            format!("author {author}"),
            format!("author-mail <{}@x.dev>", author.to_lowercase()),
            "author-time 1700000000".into(),
            "author-tz +0000".into(),
            format!("committer {author}"),
            format!("summary {summary}"),
        ]
    }

    fn refs(v: &[String]) -> Vec<&str> {
        v.iter().map(String::as_str).collect()
    }

    #[test]
    fn a_boundary_commit_is_flagged_and_its_later_groups_reuse_it() {
        let mut m = meta("Ada", "root");
        m.push("boundary".into());
        let text = [
            group(A, 3, 1, &refs(&m), "f.txt"),
            group(B, 2, 1, &refs(&meta("Bo", "edit")), "f.txt"),
            group(A, 1, 1, &[], "f.txt"),
        ]
        .concat();
        let parsed = parse_incremental(&text, 3);
        assert_eq!(parsed.commits.len(), 2);
        assert!(parsed.commits[0].boundary);
        assert!(!parsed.commits[1].boundary);
        assert_eq!(parsed.commits[0].author_email, "ada@x.dev");
        assert_eq!(
            parsed.hunks,
            vec![
                GitBlameHunk { start: 1, count: 1, commit: 0 },
                GitBlameHunk { start: 2, count: 1, commit: 1 },
                GitBlameHunk { start: 3, count: 1, commit: 0 },
            ]
        );
    }

    #[test]
    fn adjacent_groups_of_one_commit_merge() {
        let text = [
            group(A, 3, 2, &refs(&meta("Ada", "x")), "f.txt"),
            group(A, 1, 2, &[], "f.txt"),
        ]
        .concat();
        let parsed = parse_incremental(&text, 4);
        assert_eq!(parsed.hunks, vec![GitBlameHunk { start: 1, count: 4, commit: 0 }]);
    }

    #[test]
    fn uncommitted_lines_use_the_zero_sha() {
        let mut m = meta("Not Committed Yet", "Version of f.txt from f.txt");
        m.push(format!("previous {A} f.txt"));
        let text = group(ZERO, 1, 2, &refs(&m), "f.txt");
        let parsed = parse_incremental(&text, 2);
        assert!(parsed.commits[0].uncommitted);
        assert_eq!(parsed.commits[0].previous_sha.as_deref(), Some(A));
    }

    #[test]
    fn filenames_with_spaces_stay_bare_and_quoted_ones_are_unquoted() {
        let mut m = meta("Ada", "rename");
        m.push(format!("previous {B} old name.txt"));
        let text = [
            group(A, 1, 1, &refs(&m), "new name.txt"),
            group(B, 2, 1, &refs(&meta("Bo", "q")), "\"sp\\303\\244t \\\"q\\\".txt\""),
        ]
        .concat();
        let parsed = parse_incremental(&text, 2);
        assert_eq!(parsed.commits[0].filename, "new name.txt");
        assert_eq!(parsed.commits[0].previous_filename.as_deref(), Some("old name.txt"));
        assert_eq!(parsed.commits[1].filename, "sp\u{e4}t \"q\".txt");
    }

    #[test]
    fn a_summary_that_looks_like_a_header_is_not_one() {
        let summary = format!("{A} 1 1 1");
        let text = group(B, 1, 1, &refs(&meta("Ada", &summary)), "f.txt");
        let parsed = parse_incremental(&text, 1);
        assert_eq!(parsed.commits.len(), 1);
        assert_eq!(parsed.commits[0].summary, summary);
    }

    #[test]
    fn hunks_past_the_file_or_overlapping_are_dropped() {
        let text = [
            group(A, 1, 2, &refs(&meta("Ada", "x")), "f.txt"),
            group(B, 2, 1, &refs(&meta("Bo", "y")), "f.txt"),
            group(B, 3, 5, &[], "f.txt"),
            group(B, 0, 1, &[], "f.txt"),
        ]
        .concat();
        let parsed = parse_incremental(&text, 3);
        assert_eq!(parsed.hunks, vec![GitBlameHunk { start: 1, count: 2, commit: 0 }]);
    }

    #[test]
    fn an_unterminated_group_yields_no_hunk() {
        let text = format!("{A} 1 1 1\nauthor Ada\n");
        let parsed = parse_incremental(&text, 1);
        assert!(parsed.hunks.is_empty());
    }

    #[test]
    fn a_header_with_a_short_or_non_hex_id_is_ignored() {
        let text = "abc 1 1 1\nfilename f\n--all 1 1 1\nfilename f\n";
        let parsed = parse_incremental(text, 1);
        assert!(parsed.commits.is_empty());
        assert!(parsed.hunks.is_empty());
    }

    #[test]
    fn unquote_leaves_plain_paths_alone() {
        assert_eq!(unquote_path("a b/c.txt"), "a b/c.txt");
        assert_eq!(unquote_path("\"a\\tb\""), "a\tb");
        assert_eq!(unquote_path("\"trailing\\\""), "trailing\\");
    }

    #[test]
    fn line_count_counts_a_final_line_without_newline() {
        assert_eq!(line_count(b""), 0);
        assert_eq!(line_count(b"a"), 1);
        assert_eq!(line_count(b"a\n"), 1);
        assert_eq!(line_count(b"a\nb"), 2);
    }
}
