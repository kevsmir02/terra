//! Turn checkpoints against real repositories: taking one leaves the user's
//! index, HEAD, stash and worktree exactly as they were; the turn's changes
//! diff against it; a revert touches only the files it is given.

mod common;

use std::process::Command;

use common::{git_available, GitRepoFixture};
use terra_lib::modules::git::checkpoint::{
    changes, create, drop_session, file_diff, revert, CheckpointOutcome, Limits, TurnStatus,
    DEFAULT_LIMITS, REF_PREFIX,
};
use terra_lib::modules::git::errors::GitError;
use terra_lib::modules::workspace::WorkspaceRegistry;

const SESSION: u64 = 42;
const NOW: u64 = 1_700_000_000_000;

fn no_git() -> bool {
    if !git_available() {
        eprintln!("skipping: git not on PATH");
        return true;
    }
    false
}

fn raw(fx: &GitRepoFixture, args: &[&str]) -> Vec<u8> {
    let out = Command::new("git")
        .args(args)
        .current_dir(&fx.repo_path)
        .output()
        .expect("git on PATH");
    assert!(out.status.success(), "git {args:?} failed");
    out.stdout
}

fn text(fx: &GitRepoFixture, args: &[&str]) -> String {
    String::from_utf8(raw(fx, args)).expect("utf-8")
}

/// A repo with two committed files, a stash entry, a staged edit, an
/// unstaged edit and an ignored file.
fn busy_repo() -> GitRepoFixture {
    let fx = GitRepoFixture::new();
    fx.write_file(".gitignore", "*.log\n");
    fx.write_file("keep.txt", "keep\n");
    fx.write_file("edit.txt", "one\n");
    fx.run_git(&["add", "."]);
    fx.run_git(&["commit", "-q", "-m", "base"]);
    fx.write_file("edit.txt", "stashed\n");
    fx.run_git(&["stash", "push", "-q", "-m", "user stash"]);
    fx.write_file("edit.txt", "staged\n");
    fx.run_git(&["add", "edit.txt"]);
    fx.write_file("edit.txt", "unstaged\n");
    fx.write_file("debug.log", "noise\n");
    fx
}

fn take(fx: &GitRepoFixture, pane: u32, now: u64) -> String {
    match create(&fx.registry, &fx.repo_str(), SESSION, pane, now, DEFAULT_LIMITS).expect("create") {
        CheckpointOutcome::Ready { id, .. } => id,
        other => panic!("expected a checkpoint, got {other:?}"),
    }
}

fn user_state(fx: &GitRepoFixture) -> (Vec<u8>, String, String, String, String) {
    (
        std::fs::read(fx.repo_path.join(".git/index")).expect("index"),
        text(fx, &["rev-parse", "HEAD"]),
        text(fx, &["stash", "list"]),
        text(fx, &["status", "--porcelain=v1", "--untracked-files=all"]),
        text(fx, &["for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags", "refs/stash"]),
    )
}

fn checkpoint_refs(fx: &GitRepoFixture) -> Vec<String> {
    text(fx, &["for-each-ref", "--format=%(refname)", REF_PREFIX])
        .lines()
        .map(str::to_string)
        .collect()
}

fn read(fx: &GitRepoFixture, rel: &str) -> String {
    std::fs::read_to_string(fx.repo_path.join(rel)).expect("read")
}

#[test]
fn a_snapshot_leaves_index_head_stash_and_worktree_untouched() {
    if no_git() {
        return;
    }
    let fx = busy_repo();
    let before = user_state(&fx);
    let id = take(&fx, 1, NOW);
    assert_eq!(user_state(&fx), before);
    assert_eq!(read(&fx, "edit.txt"), "unstaged\n");

    let snap = format!("{REF_PREFIX}{id}");
    let tree = text(&fx, &["ls-tree", "-r", "--name-only", &snap]);
    assert!(tree.contains("edit.txt") && !tree.contains("debug.log"), "{tree}");
    assert_eq!(text(&fx, &["show", &format!("{snap}:edit.txt")]), "unstaged\n");
    assert_eq!(checkpoint_refs(&fx), vec![snap]);
    assert!(text(&fx, &["log", "--all", "--oneline", "--exclude=refs/terra/*"]).lines().count() >= 1);
}

#[test]
fn outside_a_repo_nothing_happens_and_outside_the_workspace_is_refused() {
    if no_git() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(&root).unwrap();
    let cwd = terra_lib::modules::fs::to_canon(&root);
    assert_eq!(
        create(&registry, &cwd, SESSION, 1, NOW, DEFAULT_LIMITS).unwrap(),
        CheckpointOutcome::NotARepo
    );

    let fx = busy_repo();
    let stranger = WorkspaceRegistry::default();
    assert!(matches!(
        create(&stranger, &fx.repo_str(), SESSION, 1, NOW, DEFAULT_LIMITS),
        Err(GitError::PathOutsideWorkspace(_))
    ));
    assert!(checkpoint_refs(&fx).is_empty());
}

#[test]
fn an_unchanged_tree_reuses_the_panes_checkpoint() {
    if no_git() {
        return;
    }
    let fx = busy_repo();
    let first = take(&fx, 1, NOW);
    let again = create(&fx.registry, &fx.repo_str(), SESSION, 1, NOW + 5, DEFAULT_LIMITS).unwrap();
    assert_eq!(
        again,
        CheckpointOutcome::Ready {
            repo_root: fx.repo_str(),
            id: first,
            reused: true
        }
    );
    fx.write_file("keep.txt", "changed\n");
    assert_ne!(take(&fx, 1, NOW + 10), take(&fx, 2, NOW + 10));
    assert_eq!(checkpoint_refs(&fx).len(), 3);
}

#[test]
fn changes_list_modified_created_and_deleted_files_and_diff_each() {
    if no_git() {
        return;
    }
    let fx = busy_repo();
    let id = take(&fx, 1, NOW);
    fx.write_file("edit.txt", "agent\n");
    fx.write_file("src/created.rs", "fn main() {}\n");
    std::fs::remove_file(fx.repo_path.join("keep.txt")).unwrap();
    fx.write_file("more.log", "ignored\n");

    let turn = changes(&fx.registry, &fx.repo_str(), &id, DEFAULT_LIMITS).unwrap();
    let mut got: Vec<(String, TurnStatus)> = turn.files.iter().map(|f| (f.path.clone(), f.status)).collect();
    got.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        got,
        vec![
            ("edit.txt".into(), TurnStatus::Modified),
            ("keep.txt".into(), TurnStatus::Deleted),
            ("src/created.rs".into(), TurnStatus::Added),
        ]
    );
    assert!(turn.index_restorable);

    let d = file_diff(&fx.registry, &fx.repo_str(), &id, "edit.txt").unwrap();
    assert_eq!((d.original_content.as_str(), d.modified_content.as_str()), ("unstaged\n", "agent\n"));
    let created = file_diff(&fx.registry, &fx.repo_str(), &id, "src/created.rs").unwrap();
    assert_eq!(created.original_content, "");
    assert_eq!(created.modified_content, "fn main() {}\n");
}

#[test]
fn revert_restores_modified_and_deleted_removes_created_and_spares_the_rest() {
    if no_git() {
        return;
    }
    let fx = busy_repo();
    let id = take(&fx, 1, NOW);
    let index_before = std::fs::read(fx.repo_path.join(".git/index")).unwrap();
    fx.write_file("edit.txt", "agent\n");
    fx.write_file("src/created.rs", "fn main() {}\n");
    std::fs::remove_file(fx.repo_path.join("keep.txt")).unwrap();
    fx.write_file("user.txt", "the user's own file\n");

    let paths: Vec<String> = ["edit.txt", "src/created.rs", "keep.txt"].map(String::from).to_vec();
    let out = revert(&fx.registry, &fx.repo_str(), &id, &paths, false, DEFAULT_LIMITS).unwrap();
    assert_eq!((out.restored, out.removed, out.index_restored), (2, 1, 0));
    assert_eq!(read(&fx, "edit.txt"), "unstaged\n");
    assert_eq!(read(&fx, "keep.txt"), "keep\n");
    assert!(!fx.repo_path.join("src/created.rs").exists());
    assert_eq!(read(&fx, "user.txt"), "the user's own file\n", "not in the given set");
    assert_eq!(read(&fx, "debug.log"), "noise\n");
    assert_eq!(std::fs::read(fx.repo_path.join(".git/index")).unwrap(), index_before);
}

#[test]
fn revert_refuses_a_path_the_turn_did_not_change_and_touches_nothing() {
    if no_git() {
        return;
    }
    let fx = busy_repo();
    let id = take(&fx, 1, NOW);
    fx.write_file("edit.txt", "agent\n");
    for bad in ["keep.txt", "debug.log", "../outside.txt"] {
        let paths = vec!["edit.txt".to_string(), bad.to_string()];
        assert!(
            revert(&fx.registry, &fx.repo_str(), &id, &paths, false, DEFAULT_LIMITS).is_err(),
            "{bad}"
        );
        assert_eq!(read(&fx, "edit.txt"), "agent\n", "all or nothing");
    }
    assert!(revert(&fx.registry, &fx.repo_str(), "../../heads/main", &["edit.txt".into()], false, DEFAULT_LIMITS).is_err());
}

#[test]
fn revert_restores_the_index_only_when_asked() {
    if no_git() {
        return;
    }
    let fx = busy_repo();
    let id = take(&fx, 1, NOW);
    let staged_before = text(&fx, &["show", ":edit.txt"]);
    fx.write_file("edit.txt", "agent\n");
    fx.write_file("new.txt", "agent file\n");
    fx.run_git(&["add", "edit.txt", "new.txt"]);

    let paths: Vec<String> = vec!["edit.txt".into(), "new.txt".into()];
    let out = revert(&fx.registry, &fx.repo_str(), &id, &paths, true, DEFAULT_LIMITS).unwrap();
    assert_eq!(out.index_restored, 2);
    assert_eq!(text(&fx, &["show", ":edit.txt"]), staged_before);
    assert_eq!(text(&fx, &["ls-files", "--", "new.txt"]), "");
    assert!(!fx.repo_path.join("new.txt").exists());
}

#[test]
fn old_checkpoints_are_pruned_per_pane() {
    if no_git() {
        return;
    }
    let fx = busy_repo();
    let mut ids = Vec::new();
    for i in 0..6u64 {
        fx.write_file("keep.txt", &format!("turn {i}\n"));
        ids.push(take(&fx, 1, NOW + i));
    }
    let refs = checkpoint_refs(&fx);
    assert_eq!(refs.len(), 3, "{refs:?}");
    assert!(refs.contains(&format!("{REF_PREFIX}{}", ids[5])));
    assert!(!refs.contains(&format!("{REF_PREFIX}{}", ids[0])));
    assert!(changes(&fx.registry, &fx.repo_str(), &ids[0], DEFAULT_LIMITS).is_err());

    drop_session(&fx.repo_str(), SESSION).unwrap();
    assert!(checkpoint_refs(&fx).is_empty());
}

#[test]
fn a_working_tree_over_the_cap_is_skipped_not_hashed() {
    if no_git() {
        return;
    }
    let fx = busy_repo();
    for i in 0..5 {
        fx.write_file(&format!("gen/{i}.txt"), "x\n");
    }
    let few = Limits { max_files: 3, ..DEFAULT_LIMITS };
    let outcome = create(&fx.registry, &fx.repo_str(), SESSION, 1, NOW, few).unwrap();
    assert!(
        matches!(&outcome, CheckpointOutcome::Skipped { reason, .. } if reason.contains("changed files")),
        "{outcome:?}"
    );

    fx.write_file("big.bin", &"y".repeat(4096));
    let small = Limits { max_bytes: 1024, ..DEFAULT_LIMITS };
    let outcome = create(&fx.registry, &fx.repo_str(), SESSION, 1, NOW, small).unwrap();
    assert!(matches!(outcome, CheckpointOutcome::Skipped { .. }), "{outcome:?}");
    assert!(checkpoint_refs(&fx).is_empty());
    let objects = text(&fx, &["cat-file", "--batch-check", "--batch-all-objects"]);
    let blob = text(&fx, &["hash-object", "big.bin"]);
    assert!(!objects.contains(blob.trim()), "a skipped snapshot hashes nothing");
}
