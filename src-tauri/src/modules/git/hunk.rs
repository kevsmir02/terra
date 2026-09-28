use std::ffi::OsStr;
use std::path::Path;

use serde::Deserialize;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::operations::{is_unmerged, pathspec};
use crate::modules::git::process::{
    ensure_git_available, ensure_success, run_git, run_git_with, GitInput,
};
use crate::modules::git::review::{diff_sources, DiffSource};
use crate::modules::git::types::{DEFAULT_TIMEOUT_SECS, MAX_FILE_BYTES};
use crate::modules::git::utils::{authorized_repo_root, resolve_within_repo};
use crate::modules::workspace::WorkspaceRegistry;

const CONTEXT: usize = 3;
const MAX_HUNK_LINES: usize = 50_000;

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HunkAction {
    /// Index to worktree hunk, applied to the index.
    Stage,
    /// HEAD to index hunk, reversed out of the index.
    Unstage,
    /// Index to worktree hunk, reversed out of the worktree.
    Discard,
}

/// One change as the diff view drew it. Lines are in the view's model: the
/// text split on `\n` with any `\r` dropped, so a trailing newline is a final
/// empty line. `old_*` is the original side, `new_*` the modified side, and
/// `*_from` a 0-based line index.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HunkRequest {
    pub path: String,
    pub original_path: Option<String>,
    pub action: HunkAction,
    pub old_from: usize,
    pub old_lines: Vec<String>,
    pub new_from: usize,
    pub new_lines: Vec<String>,
}

fn pieces(text: &str) -> Vec<&str> {
    text.split('\n').collect()
}

/// Whether `text` still holds `expected` at `from`, in the view's line model.
pub(crate) fn range_matches(text: &str, from: usize, expected: &[String]) -> bool {
    let p = pieces(text);
    let Some(end) = from.checked_add(expected.len()) else {
        return false;
    };
    end <= p.len()
        && p[from..end]
            .iter()
            .zip(expected)
            .all(|(have, want)| have.strip_suffix('\r').unwrap_or(have) == want)
}

/// `target` with its lines `[from, from + len)` replaced by `other`'s lines
/// `[other_from, other_from + other_len)`, both taken byte for byte so line
/// endings survive. Callers check both ranges with `range_matches` first.
pub(crate) fn splice(
    target: &str,
    from: usize,
    len: usize,
    other: &str,
    other_from: usize,
    other_len: usize,
) -> String {
    let t = pieces(target);
    let o = pieces(other);
    let mut out: Vec<&str> = Vec::with_capacity(t.len() + other_len);
    out.extend_from_slice(&t[..from]);
    out.extend_from_slice(&o[other_from..other_from + other_len]);
    out.extend_from_slice(&t[from + len..]);
    out.join("\n")
}

fn quote_path(prefix: &str, path: &str) -> String {
    let mut out = String::with_capacity(path.len() + 4);
    out.push('"');
    out.push_str(prefix);
    for c in path.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

fn hunk_range(start: usize, len: usize) -> String {
    if len == 0 {
        format!("{start},0")
    } else {
        format!("{},{len}", start + 1)
    }
}

fn push_line(out: &mut String, sign: char, line: &str) {
    out.push(sign);
    out.push_str(line);
    if !line.ends_with('\n') {
        out.push_str("\n\\ No newline at end of file\n");
    }
}

/// A one-hunk unified patch taking `old` to `new`, with up to three lines of
/// context. `None` when the two are identical. `new_file_mode` marks `old` as
/// absent, so the patch creates the path.
pub(crate) fn single_hunk_patch(
    path: &str,
    old: &str,
    new: &str,
    new_file_mode: Option<&str>,
) -> Option<String> {
    let a: Vec<&str> = old.split_inclusive('\n').collect();
    let b: Vec<&str> = new.split_inclusive('\n').collect();
    let mut pre = 0;
    while pre < a.len() && pre < b.len() && a[pre] == b[pre] {
        pre += 1;
    }
    if pre == a.len() && pre == b.len() {
        return None;
    }
    let mut suf = 0;
    while suf < a.len() - pre && suf < b.len() - pre && a[a.len() - 1 - suf] == b[b.len() - 1 - suf]
    {
        suf += 1;
    }
    let before = pre.min(CONTEXT);
    let after = suf.min(CONTEXT);
    let start = pre - before;
    let a_len = a.len() - suf + after - start;
    let b_len = b.len() - suf + after - start;

    let mut out = format!(
        "diff --git {} {}\n",
        quote_path("a/", path),
        quote_path("b/", path)
    );
    match new_file_mode {
        Some(mode) => {
            out.push_str(&format!("new file mode {mode}\n--- /dev/null\n"));
        }
        None => out.push_str(&format!("--- {}\n", quote_path("a/", path))),
    }
    out.push_str(&format!("+++ {}\n", quote_path("b/", path)));
    out.push_str(&format!(
        "@@ -{} +{} @@\n",
        hunk_range(start, a_len),
        hunk_range(start, b_len)
    ));
    for line in &a[start..pre] {
        push_line(&mut out, ' ', line);
    }
    for line in &a[pre..a.len() - suf] {
        push_line(&mut out, '-', line);
    }
    for line in &b[pre..b.len() - suf] {
        push_line(&mut out, '+', line);
    }
    for line in &a[a.len() - suf..a.len() - suf + after] {
        push_line(&mut out, ' ', line);
    }
    Some(out)
}

/// A side of the diff as exact text, or `None` when the path is absent there.
/// Refuses what a line-based patch cannot carry faithfully.
fn read_side(git_path: &str, worktree: &Path, source: &DiffSource) -> Result<Option<String>> {
    let bytes = match source {
        DiffSource::Blob(spec) => {
            let output = run_git(
                Some(git_path),
                [OsStr::new("show"), OsStr::new("--no-textconv"), OsStr::new(spec)],
                DEFAULT_TIMEOUT_SECS,
            )?;
            if output.timed_out {
                return Err(GitError::TimedOut("git show"));
            }
            if output.exit_code != Some(0) {
                return Ok(None);
            }
            if output.truncated {
                return Err(GitError::Unsupported("this file is too large for hunk actions"));
            }
            output.stdout
        }
        DiffSource::Worktree => {
            let meta = match std::fs::symlink_metadata(worktree) {
                Ok(m) => m,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(e) => return Err(GitError::Io(e)),
            };
            if meta.file_type().is_symlink() {
                return Err(GitError::SymlinkRejected(worktree.to_path_buf()));
            }
            if !meta.is_file() {
                return Ok(None);
            }
            if meta.len() > MAX_FILE_BYTES {
                return Err(GitError::Unsupported("this file is too large for hunk actions"));
            }
            std::fs::read(worktree)?
        }
    };
    if bytes.contains(&0) {
        return Err(GitError::Unsupported("hunk actions need a text file"));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| GitError::Unsupported("hunk actions need a UTF-8 text file"))
}

fn worktree_mode(path: &Path) -> &'static str {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(m) if m.permissions().mode() & 0o111 != 0 => "100755",
        _ => "100644",
    }
}

fn apply_patch(git_path: &str, patch: &str, cached: bool, reverse: bool) -> Result<()> {
    let mut args = vec!["apply"];
    if cached {
        args.push("--cached");
    }
    if reverse {
        args.push("-R");
    }
    args.extend(["--recount", "--whitespace=nowarn", "-"]);
    let output = run_git_with(
        Some(git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
        GitInput {
            stdin: Some(patch.as_bytes()),
            env: &[],
        },
    )?;
    ensure_success(&output, "git apply failed")
}

fn remove_from_index(git_path: &str, rel: &str) -> Result<()> {
    let output = run_git(
        Some(git_path),
        ["rm", "--cached", "--quiet", "--", rel],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git rm --cached failed")
}

/// Applies one hunk of the diff the UI drew. Both sides are re-read and the
/// hunk must still sit where the UI saw it, so a stale view is refused rather
/// than applied at the wrong place; git then checks the patch's context again.
pub fn apply_hunk(registry: &WorkspaceRegistry, repo_root: &str, req: &HunkRequest) -> Result<()> {
    let repo = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    if req.old_lines.len() > MAX_HUNK_LINES || req.new_lines.len() > MAX_HUNK_LINES {
        return Err(GitError::Unsupported("this change is too large for hunk actions"));
    }
    if req.old_lines == req.new_lines {
        return Err(GitError::StaleHunk);
    }
    let worktree = resolve_within_repo(&repo.local_path, &req.path)?;
    let rel = pathspec(&repo.local_path, &worktree);
    let original_rel = match req.original_path.as_deref().filter(|p| !p.is_empty()) {
        Some(orig) => Some(pathspec(
            &repo.local_path,
            &resolve_within_repo(&repo.local_path, orig)?,
        )),
        None => None,
    };
    if is_unmerged(&repo.git_path, &rel)? {
        return Err(GitError::Unsupported(
            "resolve the conflict before staging parts of this file",
        ));
    }

    let staged = req.action == HunkAction::Unstage;
    let (a_src, b_src) = diff_sources(staged, false, &rel, original_rel.as_deref());
    let a = read_side(&repo.git_path, &worktree, &a_src)?;
    let b = read_side(&repo.git_path, &worktree, &b_src)?;
    let a_text = a.as_deref().unwrap_or("");
    let b_text = b.as_deref().unwrap_or("");
    if !range_matches(a_text, req.old_from, &req.old_lines)
        || !range_matches(b_text, req.new_from, &req.new_lines)
    {
        return Err(GitError::StaleHunk);
    }
    let (old_len, new_len) = (req.old_lines.len(), req.new_lines.len());

    match req.action {
        HunkAction::Stage => {
            let result = splice(a_text, req.old_from, old_len, b_text, req.new_from, new_len);
            if b.is_none() && result.is_empty() {
                return remove_from_index(&repo.git_path, &rel);
            }
            let mode = a.is_none().then(|| worktree_mode(&worktree));
            let patch =
                single_hunk_patch(&rel, a_text, &result, mode).ok_or(GitError::StaleHunk)?;
            apply_patch(&repo.git_path, &patch, true, false)
        }
        HunkAction::Unstage => {
            if b.is_none() {
                return Err(GitError::Unsupported(
                    "a staged deletion is unstaged as a whole file",
                ));
            }
            let result = splice(b_text, req.new_from, new_len, a_text, req.old_from, old_len);
            if a.is_none() && result.is_empty() {
                return remove_from_index(&repo.git_path, &rel);
            }
            let patch = single_hunk_patch(&rel, &result, b_text, None).ok_or(GitError::StaleHunk)?;
            apply_patch(&repo.git_path, &patch, true, true)
        }
        HunkAction::Discard => {
            if b.is_none() {
                return Err(GitError::Unsupported(
                    "a deleted file is restored as a whole file",
                ));
            }
            let result = splice(b_text, req.new_from, new_len, a_text, req.old_from, old_len);
            let patch = single_hunk_patch(&rel, &result, b_text, None).ok_or(GitError::StaleHunk)?;
            apply_patch(&repo.git_path, &patch, false, true)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn range_matching_ignores_cr_and_refuses_out_of_bounds() {
        assert!(range_matches("a\r\nb\r\n", 1, &lines(&["b"])));
        assert!(range_matches("a\nb\n", 2, &lines(&[""])));
        assert!(!range_matches("a\nb\n", 2, &lines(&["", "x"])));
        assert!(!range_matches("a\nb\n", usize::MAX, &lines(&["a"])));
        assert!(!range_matches("a\nb\n", 0, &lines(&["b"])));
        assert!(range_matches("", 0, &[]));
    }

    #[test]
    fn splice_keeps_line_endings_and_the_final_newline() {
        assert_eq!(splice("a\r\nb\r\n", 1, 1, "a\r\nB\r\n", 1, 1), "a\r\nB\r\n");
        assert_eq!(splice("a\nb", 1, 1, "a\nb\n", 1, 2), "a\nb\n");
        assert_eq!(splice("", 0, 0, "x\ny\n", 0, 2), "x\ny\n");
        assert_eq!(splice("a\nb\n", 0, 2, "", 0, 0), "");
    }

    #[test]
    fn patch_marks_a_missing_final_newline_on_each_side() {
        let p = single_hunk_patch("f", "a\nb", "a\nb\n", None).unwrap();
        assert!(p.ends_with("@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n"), "{p}");
    }

    #[test]
    fn patch_bounds_context_to_three_lines_and_counts_ranges() {
        let old = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
        let new = "1\n2\n3\n4\nX\n6\n7\n8\n9\n";
        let p = single_hunk_patch("f", old, new, None).unwrap();
        assert!(p.contains("@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+X\n 6\n 7\n 8\n"), "{p}");
    }

    #[test]
    fn patch_creates_a_new_path_from_nothing() {
        let p = single_hunk_patch("dir/new file.txt", "", "x\n", Some("100644")).unwrap();
        assert!(p.starts_with(
            "diff --git \"a/dir/new file.txt\" \"b/dir/new file.txt\"\nnew file mode 100644\n--- /dev/null\n+++ \"b/dir/new file.txt\"\n@@ -0,0 +1,1 @@\n+x\n"
        ), "{p}");
    }

    #[test]
    fn identical_sides_make_no_patch() {
        assert!(single_hunk_patch("f", "a\n", "a\n", None).is_none());
    }

    #[test]
    fn quoting_escapes_quote_and_backslash() {
        assert_eq!(quote_path("a/", "we\"ird\\name"), "\"a/we\\\"ird\\\\name\"");
    }
}
