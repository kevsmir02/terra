use std::path::{Path, PathBuf};

use crate::modules::git::types::RepoOperation;

/// The repo's git dir without spawning git: `.git` is the dir itself, or for a
/// linked worktree or submodule a file holding `gitdir: <path>`.
pub(crate) fn resolve_git_dir(repo_root: &Path) -> Option<PathBuf> {
    let dot = repo_root.join(".git");
    let meta = std::fs::metadata(&dot).ok()?;
    if meta.is_dir() {
        return Some(dot);
    }
    if !meta.is_file() || meta.len() > 4096 {
        return None;
    }
    let text = std::fs::read_to_string(&dot).ok()?;
    let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
    if target.is_empty() {
        return None;
    }
    let target = Path::new(target);
    Some(if target.is_absolute() {
        target.to_path_buf()
    } else {
        repo_root.join(target)
    })
}

/// Rebase checks come first: a stopped rebase can leave a cherry-pick marker
/// behind, and aborting that one alone would strand the rebase.
pub(crate) fn detect_operation(exists: impl Fn(&str) -> bool) -> Option<RepoOperation> {
    if exists("rebase-merge") {
        return Some(RepoOperation::Rebase);
    }
    if exists("rebase-apply") {
        return Some(if exists("rebase-apply/applying") {
            RepoOperation::Am
        } else {
            RepoOperation::Rebase
        });
    }
    if exists("MERGE_HEAD") {
        return Some(RepoOperation::Merge);
    }
    if exists("CHERRY_PICK_HEAD") {
        return Some(RepoOperation::CherryPick);
    }
    if exists("REVERT_HEAD") {
        return Some(RepoOperation::Revert);
    }
    None
}

pub(crate) fn operation_in(repo_root: &Path) -> Option<RepoOperation> {
    let git_dir = resolve_git_dir(repo_root)?;
    detect_operation(|name| git_dir.join(name).exists())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationStep {
    Abort,
    Continue,
}

pub(crate) fn operation_argv(op: RepoOperation, step: OperationStep) -> [&'static str; 2] {
    let flag = match step {
        OperationStep::Abort => "--abort",
        OperationStep::Continue => "--continue",
    };
    [op.subcommand(), flag]
}

/// Where each side of a diff comes from: a `git show` spec or the worktree.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DiffSource {
    Blob(String),
    Worktree,
}

/// An unmerged path has no stage 0, so `:path` would read as missing and the
/// whole file would render as added; it shows ours (2) against theirs (3).
pub(crate) fn diff_sources(
    staged: bool,
    conflicted: bool,
    rel: &str,
    original_rel: Option<&str>,
) -> (DiffSource, DiffSource) {
    if conflicted {
        return (
            DiffSource::Blob(format!(":2:{rel}")),
            DiffSource::Blob(format!(":3:{rel}")),
        );
    }
    if staged {
        let base = original_rel.unwrap_or(rel);
        return (
            DiffSource::Blob(format!("HEAD:{base}")),
            DiffSource::Blob(format!(":{rel}")),
        );
    }
    (DiffSource::Blob(format!(":{rel}")), DiffSource::Worktree)
}

/// A file still carrying both an opening and a closing conflict marker at the
/// start of a line. One alone is not enough: `=======` is a setext heading and
/// a stray `<<<<<<<` shows up in docs about conflicts.
pub(crate) fn has_conflict_markers(text: &str) -> bool {
    let mut open = false;
    for line in text.lines() {
        if line.starts_with("<<<<<<<") {
            open = true;
        } else if open && line.starts_with(">>>>>>>") {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn probe(present: &[&str]) -> impl Fn(&str) -> bool {
        let set: HashSet<String> = present.iter().map(|s| s.to_string()).collect();
        move |name| set.contains(name)
    }

    #[test]
    fn a_clean_git_dir_has_no_operation() {
        assert_eq!(detect_operation(probe(&[])), None);
        assert_eq!(detect_operation(probe(&["ORIG_HEAD", "FETCH_HEAD"])), None);
    }

    #[test]
    fn each_marker_maps_to_its_operation() {
        assert_eq!(detect_operation(probe(&["MERGE_HEAD"])), Some(RepoOperation::Merge));
        assert_eq!(detect_operation(probe(&["rebase-merge"])), Some(RepoOperation::Rebase));
        assert_eq!(detect_operation(probe(&["rebase-apply"])), Some(RepoOperation::Rebase));
        assert_eq!(
            detect_operation(probe(&["rebase-apply", "rebase-apply/applying"])),
            Some(RepoOperation::Am)
        );
        assert_eq!(
            detect_operation(probe(&["CHERRY_PICK_HEAD"])),
            Some(RepoOperation::CherryPick)
        );
        assert_eq!(detect_operation(probe(&["REVERT_HEAD"])), Some(RepoOperation::Revert));
    }

    #[test]
    fn a_rebase_wins_over_the_cherry_pick_marker_it_leaves() {
        assert_eq!(
            detect_operation(probe(&["rebase-merge", "CHERRY_PICK_HEAD"])),
            Some(RepoOperation::Rebase)
        );
    }

    #[test]
    fn operation_argv_is_the_subcommand_and_one_flag() {
        assert_eq!(
            operation_argv(RepoOperation::CherryPick, OperationStep::Abort),
            ["cherry-pick", "--abort"]
        );
        assert_eq!(
            operation_argv(RepoOperation::Rebase, OperationStep::Continue),
            ["rebase", "--continue"]
        );
    }

    #[test]
    fn operation_names_round_trip_and_reject_unknown() {
        for op in [
            RepoOperation::Merge,
            RepoOperation::Rebase,
            RepoOperation::CherryPick,
            RepoOperation::Revert,
            RepoOperation::Am,
        ] {
            assert_eq!(RepoOperation::parse(op.subcommand()), Some(op));
        }
        for bad in ["", "Merge", "--abort", "bisect", "merge "] {
            assert_eq!(RepoOperation::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_conflicted_path_never_reads_stage_zero_or_the_worktree() {
        for staged in [false, true] {
            let (a, b) = diff_sources(staged, true, "src/a.rs", Some("src/old.rs"));
            assert_eq!(a, DiffSource::Blob(":2:src/a.rs".into()));
            assert_eq!(b, DiffSource::Blob(":3:src/a.rs".into()));
        }
    }

    #[test]
    fn ordinary_paths_keep_index_and_head_sides() {
        assert_eq!(
            diff_sources(false, false, "a.rs", None),
            (DiffSource::Blob(":a.rs".into()), DiffSource::Worktree)
        );
        assert_eq!(
            diff_sources(true, false, "new.rs", Some("old.rs")),
            (
                DiffSource::Blob("HEAD:old.rs".into()),
                DiffSource::Blob(":new.rs".into())
            )
        );
    }

    #[test]
    fn conflict_markers_need_an_opening_and_a_closing_line() {
        assert!(has_conflict_markers("a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> side\n"));
        assert!(!has_conflict_markers("Title\n=======\nbody\n"));
        assert!(!has_conflict_markers("<<<<<<< only an opener\n"));
        assert!(!has_conflict_markers(">>>>>>> closer before\n<<<<<<< opener\n"));
        assert!(!has_conflict_markers("  <<<<<<< indented\n  >>>>>>> indented\n"));
    }

    #[test]
    fn a_worktree_gitdir_file_resolves_relative_and_absolute() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join(".git"), "gitdir: ../main/.git/worktrees/x\n").unwrap();
        assert_eq!(
            resolve_git_dir(root),
            Some(root.join("../main/.git/worktrees/x"))
        );
        std::fs::write(root.join(".git"), "gitdir: /abs/wt\n").unwrap();
        assert_eq!(resolve_git_dir(root), Some(PathBuf::from("/abs/wt")));
        std::fs::write(root.join(".git"), "not a pointer\n").unwrap();
        assert_eq!(resolve_git_dir(root), None);
    }
}
