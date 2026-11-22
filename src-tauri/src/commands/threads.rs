//! Thread lifecycle & chat commands.

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::agents::events::AgentKind;
use crate::db::chat::{self, ChatItem};
use crate::db::settings;
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
    pub cwd: String,
    pub model: Option<String>,
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
    let cwd = input.cwd.trim().to_string();
    if cwd.is_empty() || !std::path::Path::new(&cwd).is_dir() {
        return Err(AppError::Invalid(format!("dossier de travail introuvable : {cwd}")));
    }
    let mode = input.permission_mode.clone().unwrap_or_else(|| "manual".into());
    if !PERMISSION_MODES.contains(&mode.as_str()) {
        return Err(AppError::Invalid(format!("mode de permission inconnu : {mode}")));
    }

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
                        now: now_ms(),
                    },
                )?;
                settings::set(c, settings::LAST_CWD, &Value::String(cwd.clone()))?;
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
    let last = state.db.call(|c| settings::get(c, settings::LAST_CWD)).await?;
    if let Some(Value::String(dir)) = last {
        if std::path::Path::new(&dir).is_dir() {
            return Ok(dir);
        }
    }
    Ok(state
        .paths
        .neuron_home
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default())
}
