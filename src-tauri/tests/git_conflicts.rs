//! Stopped merges against real repositories: detection, the ours/theirs
//! conflict view, marking a file resolved, and abort/continue.

mod common;

use common::{git_available, GitRepoFixture};
use terra_lib::modules::git::errors::GitError;
use terra_lib::modules::git::operations::{diff_content, mark_resolved, status, step_operation};
use terra_lib::modules::git::review::OperationStep;
use terra_lib::modules::git::types::RepoOperation;
use terra_lib::modules::workspace::WorkspaceRegistry;

fn no_git() -> bool {
    if !git_available() {
        eprintln!("skipping: git not on PATH");
        return true;
    }
    false
}

fn commit(fx: &GitRepoFixture, rel: &str, content: &str, message: &str, at: i64) -> String {
    fx.write_file(rel, content);
    fx.run_git(&["add", "--", rel]);
    fx.run_git_at(at, &["commit", "-q", "-m", message]);
    fx.git_stdout(&["rev-parse", "HEAD"])
}

/// A merge of `side` into `main` stopped on a conflict in `f.txt`.
fn stopped_merge() -> GitRepoFixture {
    let fx = GitRepoFixture::new();
    commit(&fx, "f.txt", "base\n", "base", 1);
    fx.run_git(&["switch", "-q", "-c", "side"]);
    commit(&fx, "f.txt", "theirs\n", "theirs", 2);
    fx.run_git(&["switch", "-q", "main"]);
    commit(&fx, "f.txt", "ours\n", "ours", 3);
    assert!(!fx.try_git(&["merge", "-q", "side"]), "the merge should stop on a conflict");
    fx
}

#[test]
fn a_stopped_merge_is_reported_with_its_conflicted_file() {
    if no_git() {
        return;
    }
    let fx = stopped_merge();
    let snap = status(&fx.registry, &fx.repo_str()).unwrap();
    assert_eq!(snap.operation, Some(RepoOperation::Merge));
    let file = snap.changed_files.iter().find(|f| f.path == "f.txt").unwrap();
    assert!(file.conflicted);
}

#[test]
fn a_repo_with_history_and_no_stopped_operation_reports_none() {
    if no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    commit(&fx, "a.txt", "a", "A", 1);
    assert_eq!(status(&fx.registry, &fx.repo_str()).unwrap().operation, None);
}

#[test]
fn a_conflicted_file_diffs_ours_against_theirs_in_both_modes() {
    if no_git() {
        return;
    }
    let fx = stopped_merge();
    for staged in [false, true] {
        let res = diff_content(&fx.registry, &fx.repo_str(), "f.txt", staged, None).unwrap();
        assert!(res.conflict);
        assert_eq!(res.original_content, "ours\n");
        assert_eq!(res.modified_content, "theirs\n");
    }
}

#[test]
fn mark_resolved_refuses_markers_and_clean_paths_then_stages_a_resolution() {
    if no_git() {
        return;
    }
    let fx = stopped_merge();
    let root = fx.repo_str();
    assert!(mark_resolved(&fx.registry, &root, "f.txt").is_err());

    fx.write_file("other.txt", "x");
    assert!(mark_resolved(&fx.registry, &root, "other.txt").is_err());

    fx.write_file("f.txt", "resolved\n");
    mark_resolved(&fx.registry, &root, "f.txt").unwrap();
    let snap = status(&fx.registry, &root).unwrap();
    let file = snap.changed_files.iter().find(|f| f.path == "f.txt").unwrap();
    assert!(!file.conflicted);
}

#[test]
fn continue_is_refused_while_conflicts_remain_and_a_mismatched_operation_never_runs() {
    if no_git() {
        return;
    }
    let fx = stopped_merge();
    let root = fx.repo_str();
    assert!(step_operation(&fx.registry, &root, "merge", OperationStep::Continue).is_err());
    for wrong in ["rebase", "cherry-pick", "bogus", ""] {
        assert!(
            step_operation(&fx.registry, &root, wrong, OperationStep::Abort).is_err(),
            "{wrong}"
        );
    }
    let snap = status(&fx.registry, &root).unwrap();
    assert_eq!(snap.operation, Some(RepoOperation::Merge), "nothing may have run");
}

#[test]
fn continue_after_resolving_records_the_merge() {
    if no_git() {
        return;
    }
    let fx = stopped_merge();
    let root = fx.repo_str();
    fx.write_file("f.txt", "both\n");
    mark_resolved(&fx.registry, &root, "f.txt").unwrap();
    step_operation(&fx.registry, &root, "merge", OperationStep::Continue).unwrap();
    assert_eq!(status(&fx.registry, &root).unwrap().operation, None);
    let parents = fx.git_stdout(&["log", "-1", "--format=%P"]);
    assert_eq!(parents.split_whitespace().count(), 2);
}

#[test]
fn abort_restores_the_pre_merge_tree() {
    if no_git() {
        return;
    }
    let fx = stopped_merge();
    let root = fx.repo_str();
    step_operation(&fx.registry, &root, "merge", OperationStep::Abort).unwrap();
    let snap = status(&fx.registry, &root).unwrap();
    assert_eq!(snap.operation, None);
    assert!(snap.changed_files.is_empty());
    assert_eq!(std::fs::read_to_string(fx.repo_path.join("f.txt")).unwrap(), "ours\n");
}

#[test]
fn review_operations_outside_the_registry_are_refused() {
    if no_git() {
        return;
    }
    let fx = stopped_merge();
    let root = fx.repo_str();
    let stranger = WorkspaceRegistry::default();
    let outside = |e: GitError| matches!(e, GitError::PathOutsideWorkspace(_));
    assert!(outside(
        step_operation(&stranger, &root, "merge", OperationStep::Abort).unwrap_err()
    ));
    assert!(outside(mark_resolved(&stranger, &root, "f.txt").unwrap_err()));
    let Err(err) = diff_content(&stranger, &root, "f.txt", false, None) else {
        panic!("diff_content ran outside the registry");
    };
    assert!(outside(err));
    assert!(fx.try_git(&["rev-parse", "-q", "--verify", "MERGE_HEAD"]));
}
