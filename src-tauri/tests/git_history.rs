mod common;

use common::{git_available, GitRepoFixture};
use terra_lib::modules::fs::to_canon;
use terra_lib::modules::git::blame::{self, GitBlame, BLAME_MAX_BYTES};
use terra_lib::modules::git::errors::GitError;
use terra_lib::modules::git::operations;
use terra_lib::modules::git::types::GitLogEntry;

fn skip_if_no_git() -> bool {
    if git_available() {
        return false;
    }
    eprintln!("skipping: git not on PATH");
    true
}

fn commit(fx: &GitRepoFixture, rel: &str, content: &str, message: &str, at: i64) -> String {
    fx.write_file(rel, content);
    fx.run_git(&["add", "--", rel]);
    fx.run_git_at(at, &["commit", "-q", "-m", message]);
    fx.git_stdout(&["rev-parse", "HEAD"])
}

fn subjects(entries: &[GitLogEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.subject.as_str()).collect()
}

fn shas(entries: &[GitLogEntry]) -> Vec<String> {
    entries.iter().map(|e| e.sha.clone()).collect()
}

/// add old.txt, edit it, rename it to "new name.txt", edit that, then an
/// unrelated commit on top.
fn renamed_file() -> GitRepoFixture {
    let fx = GitRepoFixture::new();
    commit(&fx, "old.txt", "a\nb\nc\n", "add", 1);
    commit(&fx, "old.txt", "a\nb\nc\nd\n", "edit old", 2);
    fx.run_git(&["mv", "old.txt", "new name.txt"]);
    fx.run_git_at(3, &["commit", "-q", "-m", "rename"]);
    commit(&fx, "new name.txt", "a\nB\nc\nd\n", "edit new", 4);
    commit(&fx, "other.txt", "x\n", "unrelated", 5);
    fx
}

fn head(fx: &GitRepoFixture) -> String {
    fx.git_stdout(&["rev-parse", "HEAD"])
}

#[test]
fn file_history_follows_a_rename_and_names_the_file_at_each_commit() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    let entries =
        operations::file_log(&fx.registry, &fx.repo_str(), "new name.txt", 50, 0, None).unwrap();
    assert_eq!(subjects(&entries), ["edit new", "rename", "edit old", "add"]);
    assert_eq!(entries[0].path.as_deref(), Some("new name.txt"));
    assert_eq!(entries[1].path.as_deref(), Some("new name.txt"));
    assert_eq!(entries[1].original_path.as_deref(), Some("old.txt"));
    assert_eq!(entries[2].path.as_deref(), Some("old.txt"));
    assert_eq!(entries[3].path.as_deref(), Some("old.txt"));
    assert_eq!((entries[2].insertions, entries[2].deletions), (1, 0));
}

#[test]
fn file_history_accepts_the_absolute_path_the_editor_holds() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    let abs = to_canon(fx.repo_path.join("new name.txt"));
    let entries = operations::file_log(&fx.registry, &fx.repo_str(), &abs, 50, 0, None).unwrap();
    assert_eq!(entries.len(), 4);
}

#[test]
fn file_history_pages_one_at_a_time_across_the_rename_without_a_gap() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    let root = fx.repo_str();
    let anchor = head(&fx);
    let full =
        operations::file_log(&fx.registry, &root, "new name.txt", 50, 0, Some(&anchor)).unwrap();
    let mut paged = Vec::new();
    for skip in 0..10 {
        let page =
            operations::file_log(&fx.registry, &root, "new name.txt", 1, skip, Some(&anchor))
                .unwrap();
        if page.is_empty() {
            break;
        }
        paged.extend(page);
    }
    assert_eq!(full.len(), 4);
    assert_eq!(shas(&paged), shas(&full));
}

/// f.txt changes on main (C) and on a merged side branch (S, newer than B),
/// with a commit that leaves f alone on top, so the newest commit touching
/// the file is not the head.
#[test]
fn file_history_pages_anchored_at_head_keep_mainline_commits() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let base = commit(&fx, "f.txt", "1\n2\n3\n4\n5\n", "A", 1);
    commit(&fx, "f.txt", "1\n2\n3\n4\nfive\n", "B", 2);
    fx.run_git(&["switch", "-q", "-c", "side", &base]);
    commit(&fx, "f.txt", "one\n2\n3\n4\n5\n", "S", 4);
    fx.run_git(&["switch", "-q", "main"]);
    commit(&fx, "g.txt", "g\n", "C", 3);
    fx.run_git_at(5, &["merge", "-q", "--no-ff", "-m", "M", "side"]);
    commit(&fx, "late.txt", "late\n", "late", 6);

    let root = fx.repo_str();
    let anchor = head(&fx);
    let full = operations::file_log(&fx.registry, &root, "f.txt", 50, 0, Some(&anchor)).unwrap();
    assert!(subjects(&full).contains(&"B"), "mainline edit missing: {:?}", subjects(&full));
    assert!(subjects(&full).contains(&"S"));
    let from_first_row =
        operations::file_log(&fx.registry, &root, "f.txt", 50, 0, Some(&full[0].sha)).unwrap();
    assert!(
        !subjects(&from_first_row).contains(&"B"),
        "fixture no longer shows why the anchor is the head and not the first row"
    );
    let mut paged = Vec::new();
    for skip in (0..20).step_by(2) {
        let page =
            operations::file_log(&fx.registry, &root, "f.txt", 2, skip, Some(&anchor)).unwrap();
        if page.is_empty() {
            break;
        }
        paged.extend(page);
    }
    assert_eq!(shas(&paged), shas(&full));
}

#[test]
fn directory_history_is_not_followed_and_lists_each_commit_under_it() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    commit(&fx, "d/a.txt", "a\n", "one", 1);
    commit(&fx, "top.txt", "t\n", "outside", 2);
    commit(&fx, "d/b.txt", "b\n", "two", 3);
    commit(&fx, "top.txt", "t2\n", "outside again", 4);
    commit(&fx, "d/a.txt", "a2\n", "three", 5);
    let root = fx.repo_str();
    let entries = operations::file_log(&fx.registry, &root, "d", 50, 0, None).unwrap();
    assert_eq!(subjects(&entries), ["three", "two", "one"]);

    let anchor = head(&fx);
    let paged: Vec<GitLogEntry> = (0..3)
        .flat_map(|skip| {
            operations::file_log(&fx.registry, &root, "d", 1, skip, Some(&anchor)).unwrap()
        })
        .collect();
    assert_eq!(shas(&paged), shas(&entries));
}

#[test]
fn a_glob_in_a_file_name_does_not_widen_the_filter() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    commit(&fx, "a.txt", "a\n", "plain", 1);
    commit(&fx, "*.txt", "star\n", "star", 2);
    let entries = operations::file_log(&fx.registry, &fx.repo_str(), "*.txt", 50, 0, None).unwrap();
    assert_eq!(subjects(&entries), ["star"]);
}

#[test]
fn file_history_refuses_a_path_outside_the_repo() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    let root = fx.repo_str();
    for bad in ["../escape.txt", "a/../../x", "HEAD:old.txt", ":(glob)*"] {
        match operations::file_log(&fx.registry, &root, bad, 10, 0, None) {
            Err(GitError::InvalidPath(_)) => {}
            other => panic!("expected InvalidPath for {bad}, got {:?}", other.map(|e| e.len())),
        }
    }
    let outside = tempfile::TempDir::new().unwrap();
    let outside_file = outside.path().join("x.txt");
    std::fs::write(&outside_file, "x").unwrap();
    match operations::file_log(&fx.registry, &root, &to_canon(&outside_file), 10, 0, None) {
        Err(GitError::PathOutsideWorkspace(_)) => {}
        other => panic!("expected PathOutsideWorkspace, got {:?}", other.map(|e| e.len())),
    }
}

#[test]
fn file_history_rejects_an_unsafe_anchor() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    let result = operations::file_log(&fx.registry, &fx.repo_str(), "old.txt", 10, 0, Some("--all"));
    assert!(matches!(result, Err(GitError::CommandFailed { .. })));
}

fn ready(outcome: GitBlame) -> (Vec<blame::GitBlameCommit>, Vec<blame::GitBlameHunk>) {
    match outcome {
        GitBlame::Ready { commits, hunks, .. } => (commits, hunks),
        other => panic!("expected a ready blame, got {other:?}"),
    }
}

#[test]
fn blame_attributes_committed_and_uncommitted_lines_across_a_rename() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    fx.write_file("new name.txt", "a\nB\nc\nd\ne\n");
    let path = to_canon(fx.repo_path.join("new name.txt"));
    let (commits, hunks) = ready(blame::blame(&fx.registry, &path).unwrap());

    let owner = |line: u32| {
        let hunk = hunks
            .iter()
            .find(|h| line >= h.start && line < h.start + h.count)
            .unwrap_or_else(|| panic!("line {line} unattributed"));
        &commits[hunk.commit as usize]
    };
    assert_eq!(owner(1).summary, "add");
    assert!(owner(1).boundary);
    assert_eq!(owner(1).filename, "old.txt");
    assert_eq!(owner(2).summary, "edit new");
    assert_eq!(owner(2).filename, "new name.txt");
    assert_eq!(owner(4).summary, "edit old");
    assert!(owner(5).uncommitted);
    assert_eq!(hunks.iter().map(|h| h.count).sum::<u32>(), 5);
}

#[test]
fn blame_of_an_untracked_file_reports_it_rather_than_failing() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    fx.write_file("fresh.txt", "x\n");
    let path = to_canon(fx.repo_path.join("fresh.txt"));
    assert_eq!(blame::blame(&fx.registry, &path).unwrap(), GitBlame::Untracked);
}

#[test]
fn blame_refuses_a_file_outside_every_root() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    let other = GitRepoFixture::new();
    other.write_file("secret.txt", "s\n");
    let path = to_canon(other.repo_path.join("secret.txt"));
    assert!(matches!(
        blame::blame(&fx.registry, &path),
        Err(GitError::PathOutsideWorkspace(_))
    ));
    assert!(matches!(
        blame::blame(&fx.registry, "new name.txt"),
        Err(GitError::InvalidPath(_))
    ));
}

#[test]
fn blame_is_off_above_the_editor_highlighting_cap() {
    if skip_if_no_git() {
        return;
    }
    let fx = renamed_file();
    let line = "x".repeat(1023) + "\n";
    let big = line.repeat((BLAME_MAX_BYTES / 1024) as usize + 1);
    commit(&fx, "big.txt", &big, "big", 6);
    let path = to_canon(fx.repo_path.join("big.txt"));
    assert_eq!(blame::blame(&fx.registry, &path).unwrap(), GitBlame::TooLarge);
}

#[test]
fn blame_outside_a_repository_says_so() {
    if skip_if_no_git() {
        return;
    }
    let fx = common::FsFixture::new();
    fx.write("loose.txt", "x\n");
    let path = fx.root_str_join("loose.txt");
    assert_eq!(blame::blame(&fx.registry, &path).unwrap(), GitBlame::NotInRepo);
}
