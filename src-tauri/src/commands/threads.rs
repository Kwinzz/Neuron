//! Thread lifecycle & chat commands.

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::agents::events::AgentKind;
use crate::db::chat::{self, ChatItem};
use crate::db::{projects, settings};
use crate::db::threads::{self, NewThread, ThreadSummary};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util::now_ms;

const PERMISSION_MODES: &[&str] = &["manual", "acceptEdits", "auto", "plan", "bypassPermissions"];

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewThreadInput {
    pub agent: AgentKind,
    /// Working directory; defaults to the project's folder, then to the last used folder.
    pub cwd: Option<String>,
    pub model: Option<String>,
    /// Reasoning effort (low | medium | high | xhigh | max); None = CLI default.
    pub effort: Option<String>,
    pub permission_mode: Option<String>,
    pub title: Option<String>,
    pub project_id: Option<String>,
    /// First message, sent right after creation.
    pub prompt: Option<String>,
}

#[tauri::command]
pub async fn create_thread(
    app: AppHandle,
    state: State<'_, AppState>,
    input: NewThreadInput,
) -> AppResult<ThreadSummary> {
    if !state.agents.supports(input.agent) {
        return Err(AppError::Invalid("cet agent arrive dans une prochaine phase".into()));
    }
    let cwd = resolve_cwd(&state, input.cwd.as_deref(), input.project_id.as_deref()).await?;
    let mode = input.permission_mode.clone().unwrap_or_else(|| "manual".into());
    validate_settings(&mode, input.effort.as_deref())?;

    // Project chats get the project context (context.md + git + recent files), frozen with the chat.
    let context = match input.project_id.clone() {
        Some(project_id) => {
            let project = state.db.call(move |c| projects::get(c, &project_id)).await?;
            match project {
                // Missing folder (moved project, demo data): no context rather than failing the chat.
                Some(p) if std::path::Path::new(&p.path).is_dir() => Some(
                    tokio::task::spawn_blocking(move || {
                        let root = std::path::PathBuf::from(&p.path);
                        crate::context::ensure_context_file(&root, &p.name)?;
                        crate::context::build(&root, &p.name, now_ms())
                    })
                    .await??,
                ),
                _ => None,
            }
        }
        None => None,
    };

    let id = uuid::Uuid::new_v4().to_string();
    let summary = {
        let (id, input, cwd, mode) = (id.clone(), input.clone(), cwd.clone(), mode.clone());
        state
            .db
            .call(move |c| {
                let model = input.model.as_deref().map(str::trim).filter(|m| !m.is_empty());
                threads::create(
                    c,
                    &NewThread {
                        id: &id,
                        agent: input.agent,
                        project_id: input.project_id.as_deref(),
                        model,
                        title: input.title.as_deref().map(str::trim).unwrap_or(""),
                        cwd: &cwd,
                        permission_mode: &mode,
                        effort: input.effort.as_deref().filter(|e| !e.is_empty()),
                        context: context.as_ref(),
                        now: now_ms(),
                    },
                )?;
                if let Some(project) = input.project_id.as_deref() {
                    projects::touch(c, project, now_ms())?;
                } else {
                    settings::set(c, settings::LAST_CWD, &Value::String(cwd.clone()))?;
                }
                threads::get(c, &id)?.ok_or_else(|| AppError::NotFound(id.clone()))
            })
            .await?
    };

    if let Some(prompt) = input.prompt.filter(|p| !p.trim().is_empty()) {
        state.agents.send_prompt(&app, &state.db, &id, &prompt).await?;
    }
    Ok(summary)
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    text: String,
) -> AppResult<()> {
    state.agents.send_prompt(&app, &state.db, &thread_id, &text).await
}

#[tauri::command]
pub async fn respond_permission(
    state: State<'_, AppState>,
    thread_id: String,
    request_id: String,
    allow: bool,
) -> AppResult<()> {
    state.agents.respond_permission(&thread_id, &request_id, allow)
}

#[tauri::command]
pub async fn stop_thread(app: AppHandle, state: State<'_, AppState>, thread_id: String) -> AppResult<()> {
    state.agents.stop(&app, &state.db, &thread_id)
}

#[tauri::command]
pub async fn get_thread_history(state: State<'_, AppState>, thread_id: String) -> AppResult<Vec<ChatItem>> {
    state.db.call(move |c| chat::history(c, &thread_id)).await
}

#[tauri::command]
pub async fn rename_thread(state: State<'_, AppState>, thread_id: String, title: String) -> AppResult<()> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("le titre est vide".into()));
    }
    state.db.call(move |c| threads::rename(c, &thread_id, &title)).await
}

#[tauri::command]
pub async fn delete_thread(state: State<'_, AppState>, thread_id: String) -> AppResult<()> {
    state.agents.shutdown(&thread_id);
    state.db.call(move |c| threads::delete(c, &thread_id)).await
}

/// Ids of threads whose agent process is alive.
#[tauri::command]
pub async fn running_threads(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(state.agents.running_ids())
}

#[tauri::command]
pub async fn prompt_history(state: State<'_, AppState>, project_id: Option<String>) -> AppResult<Vec<String>> {
    state.db.call(move |c| chat::prompt_history(c, project_id.as_deref(), 100)).await
}

/// Default working directory for a new thread: last used, else the user's home.
#[tauri::command]
pub async fn default_cwd(state: State<'_, AppState>) -> AppResult<String> {
    default_cwd_inner(&state).await
}

fn validate_settings(mode: &str, effort: Option<&str>) -> AppResult<()> {
    if !PERMISSION_MODES.contains(&mode) {
        return Err(AppError::Invalid(format!("mode de permission inconnu : {mode}")));
    }
    if let Some(e) = effort.filter(|e| !e.is_empty()) {
        // Union of the levels supported by the adapters; each adapter ignores levels it doesn't know.
        if !crate::agents::codex::EFFORT_LEVELS.contains(&e) {
            return Err(AppError::Invalid(format!("niveau de raisonnement inconnu : {e}")));
        }
    }
    Ok(())
}

/// Explicit folder > project folder > last used folder > home.
async fn resolve_cwd(state: &AppState, cwd: Option<&str>, project_id: Option<&str>) -> AppResult<String> {
    let mut dir = cwd.map(str::trim).filter(|c| !c.is_empty()).map(str::to_string);
    if dir.is_none() {
        if let Some(project) = project_id {
            let project = project.to_string();
            dir = state.db.call(move |c| projects::path_of(c, &project)).await?;
        }
    }
    let dir = match dir {
        Some(d) => d,
        None => default_cwd_inner(state).await?,
    };
    if !std::path::Path::new(&dir).is_dir() {
        return Err(AppError::Invalid(format!("dossier de travail introuvable : {dir}")));
    }
    Ok(dir)
}

async fn default_cwd_inner(state: &AppState) -> AppResult<String> {
    let last = state.db.call(|c| settings::get(c, settings::LAST_CWD)).await?;
    if let Some(Value::String(dir)) = last {
        if std::path::Path::new(&dir).is_dir() {
            return Ok(dir);
        }
    }
    Ok(state.paths.neuron_home.parent().map(|p| p.display().to_string()).unwrap_or_default())
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadSettingsInput {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: String,
}

/// Change a chat's model / reasoning effort / permissions. A running agent restarts (resuming the
/// conversation) before the next message.
#[tauri::command]
pub async fn update_thread_settings(
    state: State<'_, AppState>,
    thread_id: String,
    settings: ThreadSettingsInput,
) -> AppResult<ThreadSummary> {
    validate_settings(&settings.permission_mode, settings.effort.as_deref())?;
    let id = thread_id.clone();
    let summary = state
        .db
        .call(move |c| {
            let model = settings.model.as_deref().map(str::trim).filter(|m| !m.is_empty());
            let effort = settings.effort.as_deref().filter(|e| !e.is_empty());
            threads::update_settings(c, &id, model, effort, &settings.permission_mode)?;
            threads::get(c, &id)?.ok_or_else(|| AppError::NotFound(id.clone()))
        })
        .await?;
    state.agents.mark_stale(&thread_id);
    Ok(summary)
}

/// Register a local folder as a project (idempotent). Returns the refreshed project list.
#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    path: String,
    name: Option<String>,
) -> AppResult<Vec<projects::ProjectSummary>> {
    let path = path.trim().to_string();
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(AppError::Invalid(format!("dossier introuvable : {path}")));
    }
    let name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .or_else(|| dir.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| path.clone());
    let root = std::path::PathBuf::from(&path);
    let project_name = name.clone();
    tokio::task::spawn_blocking(move || crate::context::ensure_context_file(&root, &project_name)).await??;
    state
        .db
        .call(move |c| {
            projects::create(c, &name, &path, now_ms())?;
            projects::list(c)
        })
        .await
}

/// Forget a project (its chats are kept).
#[tauri::command]
pub async fn delete_project(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<projects::ProjectSummary>> {
    state
        .db
        .call(move |c| {
            projects::delete(c, &project_id)?;
            projects::list(c)
        })
        .await
}

/// Models per provider (Claude Code, Codex, Antigravity), read from the installed CLIs.
#[tauri::command]
pub async fn list_models(refresh: Option<bool>) -> AppResult<Vec<crate::agents::catalog::ProviderCatalog>> {
    Ok(crate::agents::catalog::catalog(refresh.unwrap_or(false)).await)
}
