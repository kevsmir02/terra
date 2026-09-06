use tauri::AppHandle;

use crate::modules::blocking::on_registry as blocking;
use crate::modules::git::operations;
use crate::modules::git::types::{
    DiscardEntry, GitBranchListResult, GitCommitFileChange, GitCommitResult,
    GitDiffContentResult, GitDiffResult, GitLogEntry, GitPanelSnapshot, GitPushResult,
    GitRepoInfo, GitStatusSnapshot,
    GitStashEntry,
};

#[tauri::command]
pub async fn git_resolve_repo(
    cwd: String,
    app: AppHandle,
) -> Result<Option<GitRepoInfo>, String> {
    blocking(app, move |r| {
        operations::resolve_repo(r, &cwd).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_panel_snapshot(
    cwd: String,
    app: AppHandle,
) -> Result<GitPanelSnapshot, String> {
    blocking(app, move |r| {
        operations::panel_snapshot(r, &cwd).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_status(
    repo_root: String,
    app: AppHandle,
) -> Result<GitStatusSnapshot, String> {
    blocking(app, move |r| {
        operations::status(r, &repo_root).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_diff(
    repo_root: String,
    path: Option<String>,
    staged: bool,
    app: AppHandle,
) -> Result<GitDiffResult, String> {
    blocking(app, move |r| {
        operations::diff(r, &repo_root, path.as_deref(), staged).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_diff_content(
    repo_root: String,
    path: String,
    staged: bool,
    original_path: Option<String>,
    app: AppHandle,
) -> Result<GitDiffContentResult, String> {
    blocking(app, move |r| {
        operations::diff_content(
            r,
            &repo_root,
            &path,
            staged,
            original_path.as_deref(),
        )
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stage(
    repo_root: String,
    paths: Vec<String>,
    app: AppHandle,
) -> Result<(), String> {
    blocking(app, move |r| {
        operations::stage(r, &repo_root, &paths).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_unstage(
    repo_root: String,
    paths: Vec<String>,
    app: AppHandle,
) -> Result<(), String> {
    blocking(app, move |r| {
        operations::unstage(r, &repo_root, &paths).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_discard(
    repo_root: String,
    entries: Vec<DiscardEntry>,
    app: AppHandle,
) -> Result<(), String> {
    blocking(app, move |r| {
        operations::discard(r, &repo_root, &entries).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_commit(
    repo_root: String,
    message: String,
    app: AppHandle,
) -> Result<GitCommitResult, String> {
    blocking(app, move |r| {
        operations::commit(r, &repo_root, &message).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_fetch(
    repo_root: String,
    app: AppHandle,
) -> Result<(), String> {
    blocking(app, move |r| {
        operations::fetch(r, &repo_root).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_pull_ff_only(
    repo_root: String,
    app: AppHandle,
) -> Result<(), String> {
    blocking(app, move |r| {
        operations::pull_ff_only(r, &repo_root).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_push(
    repo_root: String,
    app: AppHandle,
) -> Result<GitPushResult, String> {
    blocking(app, move |r| {
        operations::push(r, &repo_root).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_log(
    repo_root: String,
    limit: Option<u32>,
    before_sha: Option<String>,
    app: AppHandle,
) -> Result<Vec<GitLogEntry>, String> {
    blocking(app, move |r| {
        operations::log(
            r,
            &repo_root,
            limit.unwrap_or(30),
            before_sha.as_deref(),
        )
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_show_commit(
    repo_root: String,
    sha: String,
    app: AppHandle,
) -> Result<GitDiffResult, String> {
    blocking(app, move |r| {
        operations::show_commit_diff(r, &repo_root, &sha).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_commit_files(
    repo_root: String,
    sha: String,
    app: AppHandle,
) -> Result<Vec<GitCommitFileChange>, String> {
    blocking(app, move |r| {
        operations::commit_files(r, &repo_root, &sha).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_commit_file_diff(
    repo_root: String,
    sha: String,
    path: String,
    original_path: Option<String>,
    app: AppHandle,
) -> Result<GitDiffContentResult, String> {
    blocking(app, move |r| {
        operations::commit_file_diff(
            r,
            &repo_root,
            &sha,
            &path,
            original_path.as_deref(),
        )
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_remote_url(
    repo_root: String,
    name: Option<String>,
    app: AppHandle,
) -> Result<Option<String>, String> {
    let remote = name.unwrap_or_else(|| "origin".to_string());
    blocking(app, move |r| {
        operations::remote_url(r, &repo_root, &remote).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_list_branches(
    repo_root: String,
    app: AppHandle,
) -> Result<GitBranchListResult, String> {
    blocking(app, move |r| {
        operations::list_branches(r, &repo_root).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_checkout_branch(
    repo_root: String,
    branch: String,
    app: AppHandle,
) -> Result<(), String> {
    blocking(app, move |r| {
        operations::checkout_branch(r, &repo_root, &branch).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_commit_amend(
    repo_root: String,
    message: String,
    app: AppHandle,
) -> Result<GitCommitResult, String> {
    blocking(app, move |r| {
        operations::commit_amend(r, &repo_root, &message).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_push(
    repo_root: String,
    message: String,
    app: AppHandle,
) -> Result<bool, String> {
    blocking(app, move |r| {
        operations::stash_push(r, &repo_root, &message).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_pop(repo_root: String, app: AppHandle) -> Result<(), String> {
    blocking(app, move |r| {
        operations::stash_pop(r, &repo_root).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_list(
    repo_root: String,
    app: AppHandle,
) -> Result<Vec<GitStashEntry>, String> {
    blocking(app, move |r| {
        operations::stash_list(r, &repo_root).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_create_branch(
    repo_root: String,
    name: String,
    app: AppHandle,
) -> Result<(), String> {
    blocking(app, move |r| {
        operations::create_branch(r, &repo_root, &name).map_err(Into::into)
    })
    .await
}
