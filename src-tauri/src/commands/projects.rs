//! Project context: `.neuron/context.md` editing, injected-context preview, per-chat context.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::context::{self, ContextBundle, GitSnapshot, RecentFile};
use crate::db::{projects, threads};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util::now_ms;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectContextFile {
    pub project_id: String,
    pub project_name: String,
    /// Absolute path of `.neuron/context.md`.
    pub path: String,
    pub content: String,
    /// The file did not exist and was just created from the template.
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectOverview {
    pub git: Option<GitSnapshot>,
    pub recent_files: Vec<RecentFile>,
    /// Exactly what a new chat of this project would receive.
    pub preview: ContextBundle,
}

async fn project(state: &AppState, project_id: &str) -> AppResult<projects::ProjectSummary> {
    let id = project_id.to_string();
    state
        .db
        .call(move |c| projects::get(c, &id))
        .await?
        .ok_or_else(|| AppError::NotFound(crate::tr!("projet {project_id}", "project {project_id}")))
}

/// Read `.neuron/context.md` (created from the template when missing).
#[tauri::command]
pub async fn project_context(state: State<'_, AppState>, project_id: String) -> AppResult<ProjectContextFile> {
    let p = project(&state, &project_id).await?;
    tokio::task::spawn_blocking(move || {
        let root = PathBuf::from(&p.path);
        let (path, created) = context::ensure_context_file(&root, &p.name)?;
        let content = context::read_context(&root)?.unwrap_or_default();
        Ok(ProjectContextFile {
            project_id: p.id,
            project_name: p.name,
            path: path.display().to_string(),
            content,
            created,
        })
    })
    .await?
}

#[tauri::command]
pub async fn save_project_context(state: State<'_, AppState>, project_id: String, content: String) -> AppResult<()> {
    let p = project(&state, &project_id).await?;
    tokio::task::spawn_blocking(move || context::write_context(&PathBuf::from(&p.path), &content)).await?
}

/// Git snapshot, recent files and the context a new chat would get right now.
#[tauri::command]
pub async fn project_overview(state: State<'_, AppState>, project_id: String) -> AppResult<ProjectOverview> {
    let p = project(&state, &project_id).await?;
    let memory_items = state.db.call(|c| crate::db::memories::list(c)).await?;
    let opts = state.db.call(|c| crate::app_settings::load(c)).await?.context;
    tokio::task::spawn_blocking(move || {
        let root = PathBuf::from(&p.path);
        let preview = context::build(&root, &p.name, now_ms(), &opts)?;
        let memory = crate::memory::context_section(&memory_items).filter(|_| opts.inject_memory);
        let preview = context::with_memory(Some(preview), memory)
            .unwrap_or_else(|| ContextBundle { markdown: String::new(), sources: Vec::new() });
        Ok(ProjectOverview { git: context::git_snapshot(&root), recent_files: context::recent_files(&root), preview })
    })
    .await?
}

/// Context injected into a chat when it was created (None for chats outside a project).
#[tauri::command]
pub async fn thread_context(state: State<'_, AppState>, thread_id: String) -> AppResult<Option<ContextBundle>> {
    state.db.call(move |c| threads::context(c, &thread_id)).await
}
