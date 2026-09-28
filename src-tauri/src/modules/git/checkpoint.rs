//! Turn checkpoints: a snapshot of a repo's working tree taken when an agent
//! starts a turn, so the turn's changes can be listed, diffed and reverted.
//! Snapshots go through a private index and land under `refs/terra/`, so the
//! user's index, HEAD, stash and worktree are never touched to take one.
//! Retention and cost are recorded in docs/adr/0008.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fmt::{Display, Formatter};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::operations::{content_result, pathspec};
use crate::modules::git::process::{
    ensure_git_available, ensure_success, git_show_text, git_stdout_line_opt, read_text_file,
    run_git, run_git_with, GitInput,
};
use crate::modules::git::types::{GitDiffContentResult, GitOutput, DEFAULT_TIMEOUT_SECS};
use crate::modules::git::utils::{
    authorized_repo_root, canonical_dir, resolve_within_repo, ResolvedGitDirectory,
};
use crate::modules::sync::MutexExt;
use crate::modules::workspace::WorkspaceRegistry;

pub const REF_PREFIX: &str = "refs/terra/checkpoints/";
const MAX_PER_PANE: usize = 3;
const MAX_PER_REPO: usize = 20;
const MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const EXIT_TIMEOUT_SECS: u64 = 5;
const PATHS_PER_CALL: usize = 200;
const INDEX_TRAILER: &str = "Terra-Index: ";
const INDEX_TREE_TRAILER: &str = "Terra-Index-Tree: ";
const GITLINK_MODE: &str = "160000";

/// What a snapshot may cost before it is skipped: the changed and untracked
/// files it would hash, and how long any one git step may run.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_files: usize,
    pub max_bytes: u64,
    pub timeout_secs: u64,
}

pub const DEFAULT_LIMITS: Limits = Limits {
    max_files: 5_000,
    max_bytes: 64 * 1024 * 1024,
    timeout_secs: 20,
};

/// `<session>-<pane>-<millis>`: the app run that took it, the terminal pane,
/// and when. Parsed strictly, since it becomes part of a ref name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CheckpointId {
    pub session: u64,
    pub pane: u32,
    pub at_ms: u64,
}

fn digits<T: std::str::FromStr>(s: &str) -> Option<T> {
    if s.is_empty() || s.len() > 20 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

impl CheckpointId {
    pub fn parse(s: &str) -> Option<Self> {
        let mut it = s.split('-');
        let id = CheckpointId {
            session: digits(it.next()?)?,
            pane: digits(it.next()?)?,
            at_ms: digits(it.next()?)?,
        };
        it.next().is_none().then_some(id)
    }

    pub fn refname(&self) -> String {
        format!("{REF_PREFIX}{self}")
    }

    fn same_pane(&self, other: &CheckpointId) -> bool {
        self.session == other.session && self.pane == other.pane
    }
}

impl Display for CheckpointId {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}-{}-{}", self.session, self.pane, self.at_ms)
    }
}

/// Which checkpoints to delete: beyond the newest few per pane, beyond the
/// newest few per repo, or older than a week. `keep` always survives.
pub fn prune_victims(ids: &[CheckpointId], keep: CheckpointId, now_ms: u64) -> Vec<CheckpointId> {
    let mut sorted: Vec<CheckpointId> = ids.to_vec();
    sorted.sort_by(|a, b| b.at_ms.cmp(&a.at_ms).then(b.pane.cmp(&a.pane)));
    let mut per_pane: HashMap<(u64, u32), usize> = HashMap::new();
    let mut kept = usize::from(sorted.contains(&keep));
    let mut victims = Vec::new();
    for id in sorted {
        if id == keep {
            *per_pane.entry((id.session, id.pane)).or_default() += 1;
            continue;
        }
        let count = per_pane.entry((id.session, id.pane)).or_default();
        let fresh = now_ms.saturating_sub(id.at_ms) <= MAX_AGE_MS;
        if fresh && *count < MAX_PER_PANE && kept < MAX_PER_REPO {
            *count += 1;
            kept += 1;
        } else {
            victims.push(id);
        }
    }
    victims
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CheckpointOutcome {
    #[serde(rename_all = "camelCase")]
    Ready {
        repo_root: String,
        id: String,
        /// Nothing changed since the pane's last checkpoint, which stands.
        reused: bool,
    },
    NotARepo,
    #[serde(rename_all = "camelCase")]
    Skipped { repo_root: String, reason: String },
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TurnStatus {
    Added,
    Modified,
    Deleted,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TurnFile {
    pub path: String,
    pub status: TurnStatus,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TurnChanges {
    pub repo_root: String,
    pub files: Vec<TurnFile>,
    /// The checkpoint recorded the index too, so a revert can restore it.
    pub index_restorable: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevertOutcome {
    pub restored: usize,
    pub removed: usize,
    pub index_restored: usize,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

const IDENTITY: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "Terra"),
    ("GIT_AUTHOR_EMAIL", "terra@localhost"),
    ("GIT_COMMITTER_NAME", "Terra"),
    ("GIT_COMMITTER_EMAIL", "terra@localhost"),
];

fn succeeded(output: &GitOutput, context: &'static str) -> Result<String> {
    ensure_success(output, context)?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git(repo: &ResolvedGitDirectory, args: &[&OsStr], timeout: u64, context: &'static str) -> Result<String> {
    succeeded(&run_git(Some(&repo.git_path), args, timeout)?, context)
}

fn git_in_index(
    repo: &ResolvedGitDirectory,
    index: &Path,
    args: &[&OsStr],
    timeout: u64,
    context: &'static str,
) -> Result<GitOutput> {
    let env = [("GIT_INDEX_FILE", index.as_os_str())];
    let output = run_git_with(
        Some(&repo.git_path),
        args,
        timeout,
        GitInput { stdin: None, env: &env },
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut(context));
    }
    Ok(output)
}

/// Why this snapshot would cost too much, or `None` when it fits. Counts the
/// files `git add -A` would hash: tracked ones that changed and untracked
/// ones `.gitignore` lets through.
fn over_budget(repo: &ResolvedGitDirectory, limits: Limits) -> Result<Option<String>> {
    let output = run_git(
        Some(&repo.git_path),
        ["ls-files", "-z", "--modified", "--others", "--exclude-standard"],
        limits.timeout_secs,
    )?;
    if output.timed_out {
        return Ok(Some(format!(
            "listing the changes took longer than {}s",
            limits.timeout_secs
        )));
    }
    ensure_success(&output, "git ls-files failed")?;
    if output.truncated {
        return Ok(Some(format!("more than {} changed files", limits.max_files)));
    }
    let mut seen: HashSet<&[u8]> = HashSet::new();
    let mut bytes: u64 = 0;
    for raw in output.stdout.split(|b| *b == 0).filter(|p| !p.is_empty()) {
        if !seen.insert(raw) {
            continue;
        }
        if seen.len() > limits.max_files {
            return Ok(Some(format!("more than {} changed files", limits.max_files)));
        }
        let rel = Path::new(OsStr::from_bytes(raw));
        if let Ok(meta) = std::fs::symlink_metadata(repo.local_path.join(rel)) {
            if meta.is_file() {
                bytes = bytes.saturating_add(meta.len());
            }
        }
        if bytes > limits.max_bytes {
            return Ok(Some(format!(
                "more than {} MiB of changed files",
                limits.max_bytes / (1024 * 1024)
            )));
        }
    }
    Ok(None)
}

struct Snapshot {
    tree: String,
    index_tree: Option<String>,
}

fn index_path(repo: &ResolvedGitDirectory) -> Result<PathBuf> {
    let line = git(
        repo,
        &[OsStr::new("rev-parse"), OsStr::new("--git-path"), OsStr::new("index")],
        DEFAULT_TIMEOUT_SECS,
        "git rev-parse --git-path failed",
    )?;
    let path = PathBuf::from(line);
    Ok(if path.is_absolute() {
        path
    } else {
        repo.local_path.join(path)
    })
}

/// The working tree as a tree object, built in a copy of the index so the
/// real one is only ever read. The copy keeps stat data, so `add -A` hashes
/// only what changed. Also returns the tree of the index as it was, when it
/// has no conflicts.
fn snapshot(repo: &ResolvedGitDirectory, limits: Limits) -> Result<Snapshot> {
    let real = index_path(repo)?;
    let dir = tempfile::tempdir()?;
    let private = dir.path().join("index");
    if real.is_file() {
        std::fs::copy(&real, &private)?;
    }
    let write_tree = [OsStr::new("write-tree")];
    let index_out = git_in_index(repo, &private, &write_tree, limits.timeout_secs, "git write-tree")?;
    let index_tree = (index_out.exit_code == Some(0))
        .then(|| String::from_utf8_lossy(&index_out.stdout).trim().to_string())
        .filter(|t| !t.is_empty());

    let add = [
        OsStr::new("-c"),
        OsStr::new("core.splitIndex=false"),
        OsStr::new("add"),
        OsStr::new("--all"),
    ];
    let added = git_in_index(repo, &private, &add, limits.timeout_secs, "git add")?;
    ensure_success(&added, "git add failed")?;
    let tree_out = git_in_index(repo, &private, &write_tree, limits.timeout_secs, "git write-tree")?;
    let tree = succeeded(&tree_out, "git write-tree failed")?;
    Ok(Snapshot { tree, index_tree })
}

fn commit_tree(repo: &ResolvedGitDirectory, tree: &str, parents: &[&str], message: &str) -> Result<String> {
    let mut args: Vec<&str> = vec!["commit-tree", "--no-gpg-sign", tree];
    for p in parents {
        args.extend(["-p", p]);
    }
    args.extend(["-m", message]);
    let env: Vec<(&str, &OsStr)> = IDENTITY.iter().map(|(k, v)| (*k, OsStr::new(v))).collect();
    let output = run_git_with(
        Some(&repo.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
        GitInput { stdin: None, env: &env },
    )?;
    succeeded(&output, "git commit-tree failed")
}

fn head_commit(repo: &ResolvedGitDirectory) -> Result<Option<String>> {
    git_stdout_line_opt(&repo.git_path, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
}

/// Every checkpoint in the repo with the commit and tree it points at.
fn list(repo: &ResolvedGitDirectory, timeout: u64) -> Result<Vec<(CheckpointId, String, String)>> {
    let output = run_git(
        Some(&repo.git_path),
        [
            "for-each-ref",
            "--format=%(refname:lstrip=3) %(objectname) %(tree)",
            REF_PREFIX,
        ],
        timeout,
    )?;
    let text = succeeded(&output, "git for-each-ref failed")?;
    Ok(text
        .lines()
        .filter_map(|line| {
            let mut it = line.split(' ');
            let id = CheckpointId::parse(it.next()?)?;
            Some((id, it.next()?.to_string(), it.next()?.to_string()))
        })
        .collect())
}

fn delete_refs(repo: &ResolvedGitDirectory, ids: &[CheckpointId], timeout: u64) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let script: String = ids.iter().map(|id| format!("delete {}\n", id.refname())).collect();
    let output = run_git_with(
        Some(&repo.git_path),
        ["update-ref", "--stdin"],
        timeout,
        GitInput {
            stdin: Some(script.as_bytes()),
            env: &[],
        },
    )?;
    ensure_success(&output, "git update-ref --stdin failed")
}

fn trailer<'a>(message: &'a str, key: &str) -> Option<&'a str> {
    message
        .lines()
        .find_map(|l| l.strip_prefix(key))
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn commit_message(repo: &ResolvedGitDirectory, sha: &str) -> Result<String> {
    git(
        repo,
        &[OsStr::new("cat-file"), OsStr::new("commit"), OsStr::new(sha)],
        DEFAULT_TIMEOUT_SECS,
        "git cat-file failed",
    )
}

fn skipped(repo: &ResolvedGitDirectory, reason: String) -> CheckpointOutcome {
    CheckpointOutcome::Skipped {
        repo_root: repo.git_path.clone(),
        reason,
    }
}

/// Snapshots the repo holding `cwd` for `pane`. Outside a repo it does nothing;
/// a working tree over `limits` is skipped with the reason rather than hashed.
pub fn create(
    registry: &WorkspaceRegistry,
    cwd: &str,
    session: u64,
    pane: u32,
    now: u64,
    limits: Limits,
) -> Result<CheckpointOutcome> {
    let cwd = canonical_dir(registry, cwd)?;
    if !registry.is_authorized(&cwd.local_path) {
        return Err(GitError::PathOutsideWorkspace(cwd.local_path));
    }
    ensure_git_available()?;
    let Some(root_line) = git_stdout_line_opt(&cwd.git_path, ["rev-parse", "--show-toplevel"])?
    else {
        return Ok(CheckpointOutcome::NotARepo);
    };
    let repo = canonical_dir(registry, &root_line)?;
    // The same grant the source-control panel makes for a cwd's repo.
    let _ = registry.authorize(&repo.local_path);

    if let Some(reason) = over_budget(&repo, limits)? {
        return Ok(skipped(&repo, reason));
    }
    let snap = match snapshot(&repo, limits) {
        Ok(s) => s,
        Err(GitError::TimedOut(_)) => {
            return Ok(skipped(
                &repo,
                format!("the snapshot took longer than {}s", limits.timeout_secs),
            ))
        }
        Err(e) => return Err(e),
    };

    let existing = list(&repo, DEFAULT_TIMEOUT_SECS)?;
    let mine = CheckpointId { session, pane, at_ms: now };
    let latest = existing
        .iter()
        .filter(|(id, _, _)| id.same_pane(&mine))
        .max_by_key(|(id, _, _)| id.at_ms);
    if let Some((id, sha, tree)) = latest {
        if *tree == snap.tree {
            let message = commit_message(&repo, sha)?;
            if trailer(&message, INDEX_TREE_TRAILER) == snap.index_tree.as_deref() {
                return Ok(CheckpointOutcome::Ready {
                    repo_root: repo.git_path.clone(),
                    id: id.to_string(),
                    reused: true,
                });
            }
        }
    }
    let id = CheckpointId {
        at_ms: latest.map_or(now, |(l, _, _)| now.max(l.at_ms + 1)),
        ..mine
    };

    let head = head_commit(&repo)?;
    let head_parent: Vec<&str> = head.as_deref().into_iter().collect();
    let mut message = String::from("Terra turn checkpoint\n");
    let mut parents: Vec<String> = Vec::new();
    if let Some(index_tree) = snap.index_tree.as_deref() {
        let index_commit = commit_tree(&repo, index_tree, &head_parent, "Terra turn checkpoint index")?;
        message.push_str(&format!("\n{INDEX_TRAILER}{index_commit}\n{INDEX_TREE_TRAILER}{index_tree}\n"));
        parents.push(index_commit);
    } else if let Some(h) = head.as_deref() {
        parents.push(h.to_string());
    }
    let parent_refs: Vec<&str> = parents.iter().map(String::as_str).collect();
    let sha = commit_tree(&repo, &snap.tree, &parent_refs, &message)?;
    git(
        &repo,
        &[
            OsStr::new("update-ref"),
            OsStr::new(&id.refname()),
            OsStr::new(&sha),
        ],
        DEFAULT_TIMEOUT_SECS,
        "git update-ref failed",
    )?;

    let mut ids: Vec<CheckpointId> = existing.iter().map(|(i, _, _)| *i).collect();
    ids.push(id);
    // A failed prune leaves an extra ref behind, never a missing one.
    let _ = delete_refs(&repo, &prune_victims(&ids, id, now), DEFAULT_TIMEOUT_SECS);

    Ok(CheckpointOutcome::Ready {
        repo_root: repo.git_path.clone(),
        id: id.to_string(),
        reused: false,
    })
}

fn resolve(repo: &ResolvedGitDirectory, id: &str) -> Result<(CheckpointId, String)> {
    let parsed = CheckpointId::parse(id).ok_or(GitError::InvalidPath(id.to_string()))?;
    let spec = format!("{}^{{commit}}", parsed.refname());
    let sha = git_stdout_line_opt(&repo.git_path, ["rev-parse", "--verify", "--quiet", &spec])?
        .ok_or(GitError::Unsupported("this checkpoint is no longer available"))?;
    Ok((parsed, sha))
}

fn parse_raw_diff(bytes: &[u8]) -> Vec<TurnFile> {
    let mut out = Vec::new();
    let mut fields = bytes.split(|b| *b == 0);
    while let (Some(meta), Some(path)) = (fields.next(), fields.next()) {
        let meta = String::from_utf8_lossy(meta);
        let parts: Vec<&str> = meta.trim_start_matches(':').split(' ').collect();
        if parts.len() < 5 || parts[0] == GITLINK_MODE || parts[1] == GITLINK_MODE {
            continue;
        }
        let status = match parts[4].chars().next() {
            Some('A') => TurnStatus::Added,
            Some('D') => TurnStatus::Deleted,
            Some('M') | Some('T') => TurnStatus::Modified,
            _ => continue,
        };
        out.push(TurnFile {
            path: String::from_utf8_lossy(path).into_owned(),
            status,
        });
    }
    out
}

fn changes_in(repo: &ResolvedGitDirectory, sha: &str, limits: Limits) -> Result<Vec<TurnFile>> {
    if let Some(reason) = over_budget(repo, limits)? {
        return Err(GitError::command("the working tree is too large to compare", reason));
    }
    let snap = snapshot(repo, limits)?;
    let output = run_git(
        Some(&repo.git_path),
        ["diff-tree", "-r", "-z", "--no-renames", "--raw", sha, &snap.tree],
        limits.timeout_secs,
    )?;
    ensure_success(&output, "git diff-tree failed")?;
    if output.truncated {
        return Err(GitError::command(
            "the turn changed too much to list",
            String::new(),
        ));
    }
    Ok(parse_raw_diff(&output.stdout))
}

/// The files the working tree changed since the checkpoint, untracked ones
/// included and ignored ones not.
pub fn changes(registry: &WorkspaceRegistry, repo_root: &str, id: &str, limits: Limits) -> Result<TurnChanges> {
    let repo = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    let (_, sha) = resolve(&repo, id)?;
    let files = changes_in(&repo, &sha, limits)?;
    let index_restorable = trailer(&commit_message(&repo, &sha)?, INDEX_TRAILER).is_some();
    Ok(TurnChanges {
        repo_root: repo.git_path.clone(),
        files,
        index_restorable,
    })
}

/// One file as it was at the checkpoint against the working tree now.
pub fn file_diff(registry: &WorkspaceRegistry, repo_root: &str, id: &str, path: &str) -> Result<GitDiffContentResult> {
    let repo = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    let (_, sha) = resolve(&repo, id)?;
    let worktree = resolve_within_repo(&repo.local_path, path)?;
    let rel = pathspec(&repo.local_path, &worktree);
    let original = git_show_text(&repo.git_path, &format!("{sha}:{rel}"))?;
    let modified = read_text_file(&worktree)?;
    let patch = run_git(
        Some(&repo.git_path),
        [
            OsStr::new("diff"),
            OsStr::new("--no-ext-diff"),
            OsStr::new(&sha),
            OsStr::new("--"),
            OsStr::new(&rel),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&patch, "git diff failed")?;
    let truncated = patch.truncated;
    let text = String::from_utf8_lossy(&patch.stdout).into_owned();
    Ok(content_result(original, modified, text, truncated, false))
}

fn literal_restore(repo: &ResolvedGitDirectory, flag: &str, source: &str, paths: &[String]) -> Result<()> {
    for chunk in paths.chunks(PATHS_PER_CALL) {
        let mut args: Vec<OsString> = vec![
            "--literal-pathspecs".into(),
            "restore".into(),
            flag.into(),
            "--source".into(),
            source.into(),
            "--".into(),
        ];
        args.extend(chunk.iter().map(OsString::from));
        let output = run_git(Some(&repo.git_path), args, DEFAULT_TIMEOUT_SECS)?;
        ensure_success(&output, "git restore failed")?;
    }
    Ok(())
}

/// Of `paths`, the ones present in `tree_ish` or in the current index, the
/// only ones `restore --staged` can act on without failing the whole call.
fn known_to_index(repo: &ResolvedGitDirectory, tree_ish: &str, paths: &[String]) -> Result<Vec<String>> {
    let mut known: HashSet<String> = HashSet::new();
    for chunk in paths.chunks(PATHS_PER_CALL) {
        for base in [
            vec!["--literal-pathspecs", "ls-tree", "-r", "-z", "--name-only", tree_ish, "--"],
            vec!["--literal-pathspecs", "ls-files", "-z", "--cached", "--"],
        ] {
            let mut args: Vec<&str> = base;
            args.extend(chunk.iter().map(String::as_str));
            let output = run_git(Some(&repo.git_path), args, DEFAULT_TIMEOUT_SECS)?;
            ensure_success(&output, "git ls-files failed")?;
            for p in output.stdout.split(|b| *b == 0).filter(|p| !p.is_empty()) {
                known.insert(String::from_utf8_lossy(p).into_owned());
            }
        }
    }
    Ok(paths.iter().filter(|p| known.contains(*p)).cloned().collect())
}

/// Puts `paths` back as they were at the checkpoint: modified and deleted
/// files from its tree, files the turn created removed. Every path must still
/// be one the turn changed, or nothing is touched. The index is left alone
/// unless `restore_index`, which puts those paths' index entries back too.
pub fn revert(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    id: &str,
    paths: &[String],
    restore_index: bool,
    limits: Limits,
) -> Result<RevertOutcome> {
    let repo = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    let (_, sha) = resolve(&repo, id)?;
    let index_commit = if restore_index {
        let message = commit_message(&repo, &sha)?;
        Some(
            trailer(&message, INDEX_TRAILER)
                .ok_or(GitError::Unsupported(
                    "this checkpoint has no index to restore; revert the files alone",
                ))?
                .to_string(),
        )
    } else {
        None
    };
    let current: HashMap<String, TurnStatus> = changes_in(&repo, &sha, limits)?
        .into_iter()
        .map(|f| (f.path, f.status))
        .collect();

    let mut restore: Vec<String> = Vec::new();
    let mut remove: Vec<(String, PathBuf)> = Vec::new();
    let mut all: Vec<String> = Vec::new();
    for p in paths {
        let abs = resolve_within_repo(&repo.local_path, p)?;
        let rel = pathspec(&repo.local_path, &abs);
        let status = current.get(&rel).ok_or_else(|| {
            GitError::command("no longer a change of this turn; reopen the list", rel.clone())
        })?;
        match status {
            TurnStatus::Added => remove.push((rel.clone(), abs)),
            TurnStatus::Modified | TurnStatus::Deleted => restore.push(rel.clone()),
        }
        all.push(rel);
    }

    literal_restore(&repo, "--worktree", &sha, &restore)?;
    let mut removed = 0;
    for (rel, abs) in &remove {
        match std::fs::symlink_metadata(abs) {
            Ok(meta) if meta.is_dir() => {
                return Err(GitError::command("refusing to remove a directory", rel.clone()))
            }
            Ok(_) => {
                std::fs::remove_file(abs)?;
                removed += 1;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(GitError::Io(e)),
        }
    }
    let mut index_restored = 0;
    if let Some(index_commit) = index_commit {
        let staged = known_to_index(&repo, &index_commit, &all)?;
        literal_restore(&repo, "--staged", &index_commit, &staged)?;
        index_restored = staged.len();
    }
    Ok(RevertOutcome {
        restored: restore.len(),
        removed,
        index_restored,
    })
}

/// Deletes the checkpoints `session` took in the repo at `git_path`.
pub fn drop_session(git_path: &str, session: u64) -> Result<()> {
    let repo = ResolvedGitDirectory {
        git_path: git_path.to_string(),
        local_path: PathBuf::from(git_path),
    };
    let ids: Vec<CheckpointId> = list(&repo, EXIT_TIMEOUT_SECS)?
        .into_iter()
        .map(|(id, _, _)| id)
        .filter(|id| id.session == session)
        .collect();
    delete_refs(&repo, &ids, EXIT_TIMEOUT_SECS)
}

/// The run's session number and the repos it checkpointed, so exit can take
/// its refs back out.
pub struct CheckpointState {
    session: u64,
    repos: Mutex<HashSet<String>>,
}

impl Default for CheckpointState {
    fn default() -> Self {
        Self {
            session: now_ms(),
            repos: Mutex::new(HashSet::new()),
        }
    }
}

impl CheckpointState {
    pub fn session(&self) -> u64 {
        self.session
    }

    pub fn remember(&self, repo_root: &str) {
        self.repos.lock_or_recover().insert(repo_root.to_string());
    }

    pub fn drop_all(&self) {
        let repos: Vec<String> = self.repos.lock_or_recover().drain().collect();
        for repo in repos {
            if let Err(e) = drop_session(&repo, self.session) {
                log::warn!("could not remove turn checkpoints: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(session: u64, pane: u32, at_ms: u64) -> CheckpointId {
        CheckpointId { session, pane, at_ms }
    }

    #[test]
    fn ids_round_trip_and_reject_anything_that_is_not_three_numbers() {
        let parsed = CheckpointId::parse("17-4-1700000000000").unwrap();
        assert_eq!(parsed, id(17, 4, 1_700_000_000_000));
        assert_eq!(parsed.to_string(), "17-4-1700000000000");
        assert_eq!(parsed.refname(), "refs/terra/checkpoints/17-4-1700000000000");
        for bad in [
            "",
            "1-2",
            "1-2-3-4",
            "a-2-3",
            "1--3",
            "-1-2-3",
            "1-2-3/../x",
            "1-99999999999-3",
            "1-2-3 ",
            "1-2-+3",
        ] {
            assert_eq!(CheckpointId::parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn prune_keeps_the_newest_per_pane_and_never_the_new_one() {
        let now = 1_000_000;
        let ids: Vec<_> = (0..6).map(|i| id(1, 1, now - 10 + i)).collect();
        let keep = id(1, 1, now - 5);
        let victims = prune_victims(&ids, keep, now);
        let mut survivors: Vec<_> = ids.iter().filter(|i| !victims.contains(i)).collect();
        survivors.sort_by_key(|i| i.at_ms);
        assert!(survivors.contains(&&keep));
        assert_eq!(survivors.len(), MAX_PER_PANE);
    }

    #[test]
    fn prune_caps_the_repo_and_drops_week_old_refs() {
        let now = MAX_AGE_MS * 3;
        let mut ids: Vec<_> = (0..30).map(|p| id(1, p, now - u64::from(p))).collect();
        ids.push(id(0, 99, now - MAX_AGE_MS - 1));
        let keep = ids[0];
        let victims = prune_victims(&ids, keep, now);
        assert_eq!(ids.len() - victims.len(), MAX_PER_REPO);
        assert!(victims.contains(&id(0, 99, now - MAX_AGE_MS - 1)));
        assert!(!victims.contains(&keep));
    }

    #[test]
    fn raw_diff_skips_gitlinks_and_maps_statuses() {
        let raw = b":000000 100644 0000 aaaa A\0new.txt\0:100644 100644 aaaa bbbb M\0mod.txt\0:100644 000000 aaaa 0000 D\0gone.txt\0:160000 160000 aaaa bbbb M\0sub\0:100644 120000 aaaa bbbb T\0link\0";
        let files = parse_raw_diff(raw);
        let got: Vec<(&str, TurnStatus)> = files.iter().map(|f| (f.path.as_str(), f.status)).collect();
        assert_eq!(
            got,
            vec![
                ("new.txt", TurnStatus::Added),
                ("mod.txt", TurnStatus::Modified),
                ("gone.txt", TurnStatus::Deleted),
                ("link", TurnStatus::Modified),
            ]
        );
    }

    #[test]
    fn trailers_read_only_their_own_key() {
        let m = "tree x\n\nTerra turn checkpoint\n\nTerra-Index: abc\nTerra-Index-Tree: def\n";
        assert_eq!(trailer(m, INDEX_TRAILER), Some("abc"));
        assert_eq!(trailer(m, INDEX_TREE_TRAILER), Some("def"));
        assert_eq!(trailer("Terra turn checkpoint\n", INDEX_TRAILER), None);
    }
}
