//! Hunk-level stage, unstage and discard against real repositories. Each
//! request is shaped the way the diff view sends it: lines split on `\n`, `\r`
//! dropped, 0-based starts on each side.

mod common;

use std::process::Command;

use common::{git_available, GitRepoFixture};
use terra_lib::modules::git::errors::GitError;
use terra_lib::modules::git::hunk::{apply_hunk, HunkAction, HunkRequest};
use terra_lib::modules::workspace::WorkspaceRegistry;

fn no_git() -> bool {
    if !git_available() {
        eprintln!("skipping: git not on PATH");
        return true;
    }
    false
}

fn raw(fx: &GitRepoFixture, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(&fx.repo_path)
        .output()
        .expect("git on PATH");
    assert!(out.status.success(), "git {args:?} failed");
    String::from_utf8(out.stdout).expect("utf-8")
}

fn index_blob(fx: &GitRepoFixture, rel: &str) -> String {
    raw(fx, &["show", &format!(":{rel}")])
}

fn worktree(fx: &GitRepoFixture, rel: &str) -> String {
    std::fs::read_to_string(fx.repo_path.join(rel)).expect("read")
}

fn hunk(
    path: &str,
    action: HunkAction,
    old: (usize, &[&str]),
    new: (usize, &[&str]),
) -> HunkRequest {
    HunkRequest {
        path: path.into(),
        original_path: None,
        action,
        old_from: old.0,
        old_lines: old.1.iter().map(|s| s.to_string()).collect(),
        new_from: new.0,
        new_lines: new.1.iter().map(|s| s.to_string()).collect(),
    }
}

const BASE: &str = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\n";
const EDITED: &str = "l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nL11\nl12\n";

/// `f.txt` committed as BASE, edited in two places far enough apart to be
/// two hunks.
fn two_hunks() -> GitRepoFixture {
    let fx = GitRepoFixture::new();
    fx.write_file("f.txt", BASE);
    fx.run_git(&["add", "f.txt"]);
    fx.run_git(&["commit", "-q", "-m", "base"]);
    fx.write_file("f.txt", EDITED);
    fx
}

#[test]
fn stages_one_of_two_hunks_and_leaves_the_other_unstaged() {
    if no_git() {
        return;
    }
    let fx = two_hunks();
    let req = hunk("f.txt", HunkAction::Stage, (1, &["l2"]), (1, &["L2"]));
    apply_hunk(&fx.registry, &fx.repo_str(), &req).expect("stage hunk");

    assert_eq!(index_blob(&fx, "f.txt"), BASE.replace("l2\n", "L2\n"));
    assert_eq!(worktree(&fx, "f.txt"), EDITED);
    let unstaged = raw(&fx, &["diff", "--", "f.txt"]);
    assert!(unstaged.contains("-l11\n+L11\n") && !unstaged.contains("L2"), "{unstaged}");
}

#[test]
fn unstages_a_staged_hunk_back_out_of_the_index() {
    if no_git() {
        return;
    }
    let fx = two_hunks();
    fx.run_git(&["add", "f.txt"]);
    let req = hunk("f.txt", HunkAction::Unstage, (10, &["l11"]), (10, &["L11"]));
    apply_hunk(&fx.registry, &fx.repo_str(), &req).expect("unstage hunk");

    assert_eq!(index_blob(&fx, "f.txt"), BASE.replace("l2\n", "L2\n"));
    assert_eq!(worktree(&fx, "f.txt"), EDITED, "the worktree is never touched");
}

#[test]
fn discards_one_hunk_from_the_worktree_only() {
    if no_git() {
        return;
    }
    let fx = two_hunks();
    let req = hunk("f.txt", HunkAction::Discard, (10, &["l11"]), (10, &["L11"]));
    apply_hunk(&fx.registry, &fx.repo_str(), &req).expect("discard hunk");

    assert_eq!(worktree(&fx, "f.txt"), BASE.replace("l2\n", "L2\n"));
    assert_eq!(index_blob(&fx, "f.txt"), BASE, "the index is never touched");
}

#[test]
fn a_stale_hunk_is_refused_and_changes_nothing() {
    if no_git() {
        return;
    }
    let fx = two_hunks();
    // A line landed above the hunk after the view drew it.
    fx.write_file("f.txt", &format!("new\n{EDITED}"));
    let req = hunk("f.txt", HunkAction::Stage, (1, &["l2"]), (1, &["L2"]));
    let err = apply_hunk(&fx.registry, &fx.repo_str(), &req).expect_err("stale");
    assert!(matches!(err, GitError::StaleHunk), "{err}");
    assert_eq!(index_blob(&fx, "f.txt"), BASE);

    let discard = hunk("f.txt", HunkAction::Discard, (10, &["l11"]), (10, &["L11"]));
    assert!(matches!(
        apply_hunk(&fx.registry, &fx.repo_str(), &discard),
        Err(GitError::StaleHunk)
    ));
    assert_eq!(worktree(&fx, "f.txt"), format!("new\n{EDITED}"));
}

#[test]
fn an_empty_or_identical_hunk_is_refused() {
    if no_git() {
        return;
    }
    let fx = two_hunks();
    let req = hunk("f.txt", HunkAction::Stage, (1, &["l2"]), (1, &["l2"]));
    assert!(apply_hunk(&fx.registry, &fx.repo_str(), &req).is_err());
    assert_eq!(index_blob(&fx, "f.txt"), BASE);
}

#[test]
fn crlf_lines_keep_their_endings() {
    if no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("w.txt", "a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\ni\r\n");
    fx.run_git(&["add", "w.txt"]);
    fx.run_git(&["commit", "-q", "-m", "crlf"]);
    fx.write_file("w.txt", "a\r\nB\r\nc\r\nd\r\ne\r\nf\r\ng\r\nH\r\ni\r\n");
    let req = hunk("w.txt", HunkAction::Stage, (1, &["b"]), (1, &["B"]));
    apply_hunk(&fx.registry, &fx.repo_str(), &req).expect("stage crlf hunk");
    assert_eq!(
        index_blob(&fx, "w.txt"),
        "a\r\nB\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\ni\r\n"
    );

    let discard = hunk("w.txt", HunkAction::Discard, (7, &["h"]), (7, &["H"]));
    apply_hunk(&fx.registry, &fx.repo_str(), &discard).expect("discard crlf hunk");
    assert_eq!(
        worktree(&fx, "w.txt"),
        "a\r\nB\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\ni\r\n"
    );
}

#[test]
fn staging_the_hunk_of_an_untracked_file_adds_it() {
    if no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("seed.txt", "s\n");
    fx.run_git(&["add", "seed.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("new.txt", "x\ny\n");
    // The view diffs an untracked file against an empty original.
    let req = hunk("new.txt", HunkAction::Stage, (0, &[]), (0, &["x", "y"]));
    apply_hunk(&fx.registry, &fx.repo_str(), &req).expect("stage new file");
    assert_eq!(index_blob(&fx, "new.txt"), "x\ny\n");
    assert_eq!(raw(&fx, &["diff", "--", "new.txt"]), "");

    let back = hunk("new.txt", HunkAction::Unstage, (0, &[]), (0, &["x", "y"]));
    apply_hunk(&fx.registry, &fx.repo_str(), &back).expect("unstage new file");
    assert_eq!(raw(&fx, &["ls-files", "--", "new.txt"]), "");
    assert_eq!(worktree(&fx, "new.txt"), "x\ny\n");
}

#[test]
fn a_missing_final_newline_is_staged_exactly() {
    if no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("n.txt", "a\nb\nc");
    fx.run_git(&["add", "n.txt"]);
    fx.run_git(&["commit", "-q", "-m", "no eol"]);

    fx.write_file("n.txt", "a\nB\nc");
    let req = hunk("n.txt", HunkAction::Stage, (1, &["b"]), (1, &["B"]));
    apply_hunk(&fx.registry, &fx.repo_str(), &req).expect("stage middle hunk");
    assert_eq!(index_blob(&fx, "n.txt"), "a\nB\nc");

    fx.write_file("n.txt", "a\nB\nc\n");
    let eol = hunk("n.txt", HunkAction::Stage, (2, &["c"]), (2, &["c", ""]));
    apply_hunk(&fx.registry, &fx.repo_str(), &eol).expect("stage added newline");
    assert_eq!(index_blob(&fx, "n.txt"), "a\nB\nc\n");

    let undo = hunk("n.txt", HunkAction::Unstage, (1, &["b", "c"]), (1, &["B", "c", ""]));
    apply_hunk(&fx.registry, &fx.repo_str(), &undo).expect("unstage both");
    assert_eq!(index_blob(&fx, "n.txt"), "a\nb\nc");
}

#[test]
fn a_repo_outside_the_workspace_and_an_escaping_path_are_refused() {
    if no_git() {
        return;
    }
    let fx = two_hunks();
    let stranger = WorkspaceRegistry::default();
    let req = hunk("f.txt", HunkAction::Stage, (1, &["l2"]), (1, &["L2"]));
    assert!(matches!(
        apply_hunk(&stranger, &fx.repo_str(), &req),
        Err(GitError::PathOutsideWorkspace(_))
    ));
    let escape = hunk("../f.txt", HunkAction::Stage, (1, &["l2"]), (1, &["L2"]));
    assert!(matches!(
        apply_hunk(&fx.registry, &fx.repo_str(), &escape),
        Err(GitError::InvalidPath(_))
    ));
    assert_eq!(index_blob(&fx, "f.txt"), BASE);
}
