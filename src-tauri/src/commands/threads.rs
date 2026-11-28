//! Thread lifecycle & chat commands.

use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::agents::events::AgentKind;
use crate::db::chat::{self, ChatItem, MessageHit};
use crate::db::threads::{self, NewThread, ThreadSummary};
use crate::db::{projects, settings};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, Shared};
use crate::util::now_ms;

const PERMISSION_MODES: &[&str] = &["manual", "acceptEdits", "auto", "plan", "bypassPermissions"];
const DEFAULT_SEARCH_LIMIT: u32 = 30;
const MAX_SEARCH_LIMIT: u32 = 100;

/// Cross-device workspace requested when creating a thread (AI runs here, files & shell run on `device_id`).
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewWorkspaceInput {
    pub device_id: String,
    pub device_name: String,
    pub cwd: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    /// Grant id issued by the target device (used when targeting a client over reverse bi-stream).
    pub grant_id: Option<String>,
    pub os: Option<String>,
}

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
    /// Files attached to the first message (from `import_attachments` / `paste_attachment`).
    #[serde(default)]
    pub attachments: Vec<crate::attachments::Attachment>,
    /// Remote device workspace target when this chat's AI operates on another paired device.
    #[serde(default)]
    pub workspace: Option<NewWorkspaceInput>,
}

pub(crate) async fn create_thread_inner(state: &Shared, input: NewThreadInput) -> AppResult<ThreadSummary> {
    if !state.agents.supports(input.agent) {
        return Err(AppError::Invalid(crate::tr!(
            "cet agent arrive dans une prochaine phase",
            "this agent comes in a later phase"
        )));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mode = input.permission_mode.clone().unwrap_or_else(|| "manual".into());
    validate_settings(&mode, input.effort.as_deref())?;

    let app_settings = state.db.call(|c| crate::app_settings::load(c)).await?;
    let ctx_opts = app_settings.context.clone();

    let (cwd, project_id_for_db, workspace_runtime, project_context) = if let Some(ws) = input.workspace.clone() {
        if !matches!(input.agent, AgentKind::ClaudeCode | AgentKind::Codex | AgentKind::Antigravity) {
            return Err(AppError::Invalid(crate::tr!(
                "l'exécution sur un autre appareil est disponible avec Claude Code, Codex et Antigravity",
                "cross-device workspace execution is available with Claude Code, Codex and Antigravity"
            )));
        }
        if ws.device_id.trim().is_empty() || ws.cwd.trim().is_empty() {
            return Err(AppError::Invalid(crate::tr!(
                "appareil ou dossier cible manquant",
                "missing target device or folder"
            )));
        }
        let scratch = state.paths.data_dir.join("remote-scratch").join(&id);
        std::fs::create_dir_all(&scratch)?;
        let ws_runtime = threads::WorkspaceRuntime {
            target: threads::WorkspaceTarget {
                device_id: ws.device_id.clone(),
                device_name: ws.device_name.clone(),
                cwd: ws.cwd.clone(),
                project_id: ws.project_id.clone(),
                project_name: ws.project_name.clone(),
                os: ws.os.clone(),
            },
            grant_id: ws.grant_id.clone(),
        };
        // Pull project context (.neuron/context.md + git + recent files) from the target device.
        let remote_ctx = if let Ok(node) = state.remote.ensure(state).await {
            let req = crate::remote::protocol::RpcRequest {
                method: "workspace_context".into(),
                args: serde_json::json!({
                    "rootCwd": ws.cwd,
                    "grantId": ws.grant_id,
                    "projectName": ws.project_name,
                }),
            };
            match node.call_peer(&ws.device_id, req, Duration::from_secs(15)).await {
                Ok(val) => serde_json::from_value::<Option<crate::context::ContextBundle>>(val).ok().flatten(),
                Err(err) => {
                    tracing::warn!(%err, device = %ws.device_id, "remote workspace context unavailable");
                    None
                }
            }
        } else {
            None
        };
        (scratch.display().to_string(), None, Some(ws_runtime), remote_ctx)
    } else {
        let cwd = resolve_cwd(state, input.cwd.as_deref(), input.project_id.as_deref()).await?;
        // Project chats get the project context (context.md + git + recent files), frozen with the chat.
        let context = match input.project_id.clone() {
            Some(project_id) => {
                let project = state.db.call(move |c| projects::get(c, &project_id)).await?;
                match project {
                    // Missing folder (moved project, demo data): no context rather than failing the chat.
                    Some(p) if std::path::Path::new(&p.path).is_dir() => Some({
                        let opts = ctx_opts.clone();
                        tokio::task::spawn_blocking(move || {
                            let root = std::path::PathBuf::from(&p.path);
                            crate::context::ensure_context_file(&root, &p.name)?;
                            crate::context::build(&root, &p.name, now_ms(), &opts)
                        })
                        .await??
                    }),
                    _ => None,
                }
            }
            None => None,
        };
        (cwd, input.project_id.clone(), None, context)
    };

    // Global memory goes into every new chat (project or not).
    let memory_file = state.paths.memory_file.clone();
    let memory_items = state
        .db
        .call(move |c| {
            crate::memory::import_if_changed(c, &memory_file, now_ms())?;
            crate::db::memories::list(c)
        })
        .await?;
    let memory_section = crate::memory::context_section(&memory_items).filter(|_| ctx_opts.inject_memory);
    let context = crate::context::with_memory(project_context, memory_section);

    let summary = {
        let (id, input, cwd, mode, ws) = (id.clone(), input.clone(), cwd.clone(), mode.clone(), workspace_runtime);
        state
            .db
            .call(move |c| {
                let model = input.model.as_deref().map(str::trim).filter(|m| !m.is_empty());
                threads::create(
                    c,
                    &NewThread {
                        id: &id,
                        agent: input.agent,
                        project_id: project_id_for_db.as_deref(),
                        model,
                        title: input.title.as_deref().map(str::trim).unwrap_or(""),
                        cwd: &cwd,
                        permission_mode: &mode,
                        effort: input.effort.as_deref().filter(|e| !e.is_empty()),
                        context: context.as_ref(),
                        workspace: ws.as_ref(),
                        now: now_ms(),
                    },
                )?;
                if let Some(project) = project_id_for_db.as_deref() {
                    projects::touch(c, project, now_ms())?;
                } else if ws.is_none() {
                    settings::set(c, settings::LAST_CWD, &Value::String(cwd.clone()))?;
                }
                threads::get(c, &id)?.ok_or_else(|| AppError::NotFound(id.clone()))
            })
            .await?
    };

    let prompt = input.prompt.unwrap_or_default();
    if !prompt.trim().is_empty() || !input.attachments.is_empty() {
        let root = crate::attachments::root(&state.paths.data_dir);
        let attachments = crate::attachments::validate(&root, &input.attachments)?;
        state.agents.send_prompt(state, &id, &prompt, attachments).await?;
    }
    Ok(summary)
}

#[tauri::command]
pub async fn create_thread(state: State<'_, Shared>, input: NewThreadInput) -> AppResult<ThreadSummary> {
    create_thread_inner(&state, input).await
}

pub(crate) async fn send_message_inner(
    state: &Shared,
    thread_id: String,
    text: String,
    attachments: Option<Vec<crate::attachments::Attachment>>,
) -> AppResult<()> {
    let root = crate::attachments::root(&state.paths.data_dir);
    let attachments = crate::attachments::validate(&root, &attachments.unwrap_or_default())?;
    state.agents.send_prompt(state, &thread_id, &text, attachments).await
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, Shared>,
    thread_id: String,
    text: String,
    attachments: Option<Vec<crate::attachments::Attachment>>,
) -> AppResult<()> {
    send_message_inner(&state, thread_id, text, attachments).await
}

pub(crate) async fn list_slash_commands_inner(
    state: &AppState,
    agent: AgentKind,
    cwd: Option<String>,
) -> AppResult<Vec<crate::agents::slash::SlashCommand>> {
    let cwd = match cwd.filter(|c| !c.trim().is_empty()) {
        Some(c) => std::path::PathBuf::from(c),
        None => std::path::PathBuf::from(default_cwd_inner(state).await?),
    };
    if !cwd.is_dir() {
        return Ok(Vec::new());
    }
    Ok(crate::agents::slash::list(agent, &cwd).await)
}

/// Slash commands of a provider in a working directory (the « / » menu). Cached 15 min.
#[tauri::command]
pub async fn list_slash_commands(
    state: State<'_, Shared>,
    agent: AgentKind,
    cwd: Option<String>,
) -> AppResult<Vec<crate::agents::slash::SlashCommand>> {
    list_slash_commands_inner(&state, agent, cwd).await
}

/// Copy files picked with the « + » button into Neuron's attachments folder.
#[tauri::command]
pub async fn import_attachments(
    state: State<'_, Shared>,
    paths: Vec<String>,
) -> AppResult<Vec<crate::attachments::Attachment>> {
    let root = crate::attachments::root(&state.paths.data_dir);
    tokio::task::spawn_blocking(move || {
        paths.iter().map(|p| crate::attachments::import_file(&root, std::path::Path::new(p))).collect()
    })
    .await?
}

pub(crate) async fn paste_attachment_inner(
    state: &AppState,
    name: String,
    mime: String,
    data: String,
) -> AppResult<crate::attachments::Attachment> {
    let root = crate::attachments::root(&state.paths.data_dir);
    tokio::task::spawn_blocking(move || crate::attachments::save_base64(&root, &name, &mime, &data)).await?
}

/// Save an image pasted from the clipboard (base64).
#[tauri::command]
pub async fn paste_attachment(
    state: State<'_, Shared>,
    name: String,
    mime: String,
    data: String,
) -> AppResult<crate::attachments::Attachment> {
    paste_attachment_inner(&state, name, mime, data).await
}

pub(crate) async fn respond_permission_inner(
    state: &AppState,
    thread_id: String,
    request_id: String,
    allow: bool,
    mode: Option<String>,
    answers: Option<std::collections::HashMap<String, String>>,
) -> AppResult<()> {
    if let Some(m) = mode.as_deref() {
        validate_settings(m, None)?;
    }
    state.agents.respond_permission(&thread_id, &request_id, allow, mode, answers)?;
    crate::agents::registry::emit_event(
        state.events.as_ref(),
        &thread_id,
        crate::agents::events::AgentEvent::PermissionResolved { request_id, allow },
    );
    Ok(())
}

#[tauri::command]
pub async fn respond_permission(
    state: State<'_, Shared>,
    thread_id: String,
    request_id: String,
    allow: bool,
    mode: Option<String>,
    answers: Option<std::collections::HashMap<String, String>>,
) -> AppResult<()> {
    respond_permission_inner(&state, thread_id, request_id, allow, mode, answers).await
}

pub(crate) async fn stop_thread_inner(state: &AppState, thread_id: String) -> AppResult<()> {
    state.agents.stop(&state.events, &state.db, &thread_id)
}

#[tauri::command]
pub async fn stop_thread(state: State<'_, Shared>, thread_id: String) -> AppResult<()> {
    stop_thread_inner(&state, thread_id).await
}

pub(crate) async fn get_thread_history_inner(state: &AppState, thread_id: String) -> AppResult<Vec<ChatItem>> {
    state.db.call(move |c| chat::history(c, &thread_id)).await
}

#[tauri::command]
pub async fn get_thread_history(state: State<'_, Shared>, thread_id: String) -> AppResult<Vec<ChatItem>> {
    get_thread_history_inner(&state, thread_id).await
}

pub(crate) async fn rename_thread_inner(state: &AppState, thread_id: String, title: String) -> AppResult<()> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid(crate::tr!("le titre est vide", "the title is empty")));
    }
    state.db.call(move |c| threads::rename(c, &thread_id, &title)).await
}

#[tauri::command]
pub async fn rename_thread(state: State<'_, Shared>, thread_id: String, title: String) -> AppResult<()> {
    rename_thread_inner(&state, thread_id, title).await
}

pub(crate) async fn delete_thread_inner(state: &AppState, thread_id: String) -> AppResult<()> {
    state.agents.shutdown(&thread_id);
    state
        .db
        .call(move |c| {
            let now = now_ms();
            let _ = crate::db::remote::revoke_grants_for_thread(c, &thread_id, now);
            threads::soft_delete(c, &thread_id, now)
        })
        .await
}

#[tauri::command]
pub async fn delete_thread(state: State<'_, Shared>, thread_id: String) -> AppResult<()> {
    delete_thread_inner(&state, thread_id).await
}

pub(crate) async fn restore_thread_inner(state: &AppState, thread_id: String) -> AppResult<ThreadSummary> {
    state
        .db
        .call(move |c| {
            threads::restore(c, &thread_id)?;
            threads::get(c, &thread_id)?.ok_or_else(|| AppError::NotFound(format!("chat {thread_id}")))
        })
        .await
}

#[tauri::command]
pub async fn restore_thread(state: State<'_, Shared>, thread_id: String) -> AppResult<ThreadSummary> {
    restore_thread_inner(&state, thread_id).await
}

pub(crate) async fn set_thread_pinned_inner(
    state: &AppState,
    thread_id: String,
    pinned: bool,
) -> AppResult<ThreadSummary> {
    state
        .db
        .call(move |c| {
            threads::set_pinned(c, &thread_id, pinned.then(now_ms))?;
            threads::get(c, &thread_id)?.ok_or_else(|| AppError::NotFound(format!("chat {thread_id}")))
        })
        .await
}

#[tauri::command]
pub async fn set_thread_pinned(state: State<'_, Shared>, thread_id: String, pinned: bool) -> AppResult<ThreadSummary> {
    set_thread_pinned_inner(&state, thread_id, pinned).await
}

pub(crate) async fn set_thread_archived_inner(
    state: &AppState,
    thread_id: String,
    archived: bool,
) -> AppResult<ThreadSummary> {
    state
        .db
        .call(move |c| {
            threads::set_archived(c, &thread_id, archived.then(now_ms))?;
            threads::get(c, &thread_id)?.ok_or_else(|| AppError::NotFound(format!("chat {thread_id}")))
        })
        .await
}

#[tauri::command]
pub async fn set_thread_archived(
    state: State<'_, Shared>,
    thread_id: String,
    archived: bool,
) -> AppResult<ThreadSummary> {
    set_thread_archived_inner(&state, thread_id, archived).await
}

pub(crate) async fn move_thread_inner(
    state: &AppState,
    thread_id: String,
    project_id: Option<String>,
) -> AppResult<ThreadSummary> {
    state
        .db
        .call(move |c| {
            threads::move_to_project(c, &thread_id, project_id.as_deref())?;
            threads::get(c, &thread_id)?.ok_or_else(|| AppError::NotFound(format!("chat {thread_id}")))
        })
        .await
}

/// Move a chat to another project (or detach it when `project_id` is `None`).
/// Only `threads.project_id` changes; the frozen context and working directory stay as they are.
#[tauri::command]
pub async fn move_thread(
    state: State<'_, Shared>,
    thread_id: String,
    project_id: Option<String>,
) -> AppResult<ThreadSummary> {
    move_thread_inner(&state, thread_id, project_id).await
}

pub(crate) async fn search_messages_inner(
    state: &AppState,
    query: String,
    limit: Option<u32>,
) -> AppResult<Vec<MessageHit>> {
    let limit = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).min(MAX_SEARCH_LIMIT);
    state.db.call(move |c| chat::search_messages(c, &query, limit)).await
}

/// Full-text search across user and assistant messages (accent-insensitive, excludes deleted chats).
#[tauri::command]
pub async fn search_messages(
    state: State<'_, Shared>,
    query: String,
    limit: Option<u32>,
) -> AppResult<Vec<MessageHit>> {
    search_messages_inner(&state, query, limit).await
}

/// Permanently remove soft-deleted chats past the 30 s undo window (at startup, then every 30 s).
pub fn spawn_deleted_purge(state: &Shared) {
    let state = Arc::clone(state);
    tauri::async_runtime::spawn(async move {
        loop {
            let cutoff = now_ms().saturating_sub(threads::DELETE_RETENTION_MS);
            match state.db.call(move |c| threads::purge_deleted(c, cutoff)).await {
                Ok(n) if n > 0 => tracing::info!(purged = n, "purged deleted threads"),
                Ok(_) => {}
                Err(err) => tracing::warn!(%err, "deleted thread purge failed"),
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

pub(crate) async fn running_threads_inner(state: &AppState) -> AppResult<Vec<String>> {
    Ok(state.agents.running_ids())
}

/// Ids of threads whose agent process is alive.
#[tauri::command]
pub async fn running_threads(state: State<'_, Shared>) -> AppResult<Vec<String>> {
    running_threads_inner(&state).await
}

pub(crate) async fn prompt_history_inner(state: &AppState, project_id: Option<String>) -> AppResult<Vec<String>> {
    state.db.call(move |c| chat::prompt_history(c, project_id.as_deref(), 100)).await
}

#[tauri::command]
pub async fn prompt_history(state: State<'_, Shared>, project_id: Option<String>) -> AppResult<Vec<String>> {
    prompt_history_inner(&state, project_id).await
}

/// Default working directory for a new thread: last used, else the user's home.
#[tauri::command]
pub async fn default_cwd(state: State<'_, Shared>) -> AppResult<String> {
    default_cwd_inner(&state).await
}

fn validate_settings(mode: &str, effort: Option<&str>) -> AppResult<()> {
    if !PERMISSION_MODES.contains(&mode) {
        return Err(AppError::Invalid(crate::tr!(
            "mode de permission inconnu : {mode}",
            "unknown permission mode: {mode}"
        )));
    }
    if let Some(e) = effort.filter(|e| !e.is_empty()) {
        // Union of the levels supported by the adapters; each adapter ignores levels it doesn't know.
        if !crate::agents::codex::EFFORT_LEVELS.contains(&e) {
            return Err(AppError::Invalid(crate::tr!(
                "niveau de raisonnement inconnu : {e}",
                "unknown reasoning level: {e}"
            )));
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
        return Err(AppError::Invalid(crate::tr!(
            "dossier de travail introuvable : {dir}",
            "working folder not found: {dir}"
        )));
    }
    Ok(dir)
}

pub(crate) async fn default_cwd_inner(state: &AppState) -> AppResult<String> {
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

pub(crate) async fn update_thread_settings_inner(
    state: &AppState,
    thread_id: String,
    settings: ThreadSettingsInput,
) -> AppResult<ThreadSummary> {
    validate_settings(&settings.permission_mode, settings.effort.as_deref())?;
    let id = thread_id.clone();
    let before = {
        let id = thread_id.clone();
        state.db.call(move |c| threads::runtime(c, &id)).await?
    };
    let summary = state
        .db
        .call(move |c| {
            let model = settings.model.as_deref().map(str::trim).filter(|m| !m.is_empty());
            let effort = settings.effort.as_deref().filter(|e| !e.is_empty());
            threads::update_settings(c, &id, model, effort, &settings.permission_mode)?;
            threads::get(c, &id)?.ok_or_else(|| AppError::NotFound(id.clone()))
        })
        .await?;
    // Only the permission mode changed: Claude Code switches it live, without restarting the session.
    let mode_only = before.as_ref().is_some_and(|b| {
        b.model == summary.model && b.effort == summary.effort && b.permission_mode != summary.permission_mode
    });
    if !(mode_only && state.agents.set_mode_live(&thread_id, summary.agent, &summary.permission_mode)) {
        state.agents.mark_stale(&thread_id);
    }
    Ok(summary)
}

/// Change a chat's model / reasoning effort / permissions. A running agent restarts (resuming the
/// conversation) before the next message.
#[tauri::command]
pub async fn update_thread_settings(
    state: State<'_, Shared>,
    thread_id: String,
    settings: ThreadSettingsInput,
) -> AppResult<ThreadSummary> {
    update_thread_settings_inner(&state, thread_id, settings).await
}

pub(crate) async fn create_project_inner(
    state: &AppState,
    path: String,
    name: Option<String>,
) -> AppResult<Vec<projects::ProjectSummary>> {
    let path = path.trim().to_string();
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(AppError::Invalid(crate::tr!("dossier introuvable : {path}", "folder not found: {path}")));
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

/// Register a local folder as a project (idempotent). Returns the refreshed project list.
#[tauri::command]
pub async fn create_project(
    state: State<'_, Shared>,
    path: String,
    name: Option<String>,
) -> AppResult<Vec<projects::ProjectSummary>> {
    create_project_inner(&state, path, name).await
}

pub(crate) async fn delete_project_inner(
    state: &AppState,
    project_id: String,
) -> AppResult<Vec<projects::ProjectSummary>> {
    state
        .db
        .call(move |c| {
            projects::delete(c, &project_id)?;
            projects::list(c)
        })
        .await
}

/// Forget a project (its chats are kept).
#[tauri::command]
pub async fn delete_project(state: State<'_, Shared>, project_id: String) -> AppResult<Vec<projects::ProjectSummary>> {
    delete_project_inner(&state, project_id).await
}

pub(crate) async fn list_models_inner(
    state: &AppState,
    refresh: Option<bool>,
) -> AppResult<Vec<crate::agents::catalog::ProviderCatalog>> {
    let mut list = crate::agents::catalog::catalog(refresh.unwrap_or(false)).await;
    // Generic CLIs from Paramètres (not cached: they change with the settings).
    let profiles = state.db.call(|c| crate::app_settings::load(c)).await?.generic_clis;
    if !profiles.is_empty() {
        list.push(crate::agents::catalog::generic_provider(&profiles));
    }
    Ok(list)
}

/// Models per provider (Claude Code, Codex, Antigravity), read from the installed CLIs.
#[tauri::command]
pub async fn list_models(
    state: State<'_, Shared>,
    refresh: Option<bool>,
) -> AppResult<Vec<crate::agents::catalog::ProviderCatalog>> {
    list_models_inner(&state, refresh).await
}

pub(crate) async fn agent_images_inner(
    state: &AppState,
    thread_id: String,
    paths: Vec<String>,
) -> AppResult<Vec<crate::attachments::Attachment>> {
    const MAX: usize = 24;
    let id = thread_id.clone();
    let cwd = state.db.call(move |conn| threads::get(conn, &id)).await?.and_then(|t| t.cwd);
    let images = tokio::task::spawn_blocking(move || {
        let cwd = cwd.map(std::path::PathBuf::from);
        let mut seen = std::collections::HashSet::new();
        paths
            .iter()
            .filter_map(|p| crate::attachments::local_image(p, cwd.as_deref()))
            .filter(|a| seen.insert(a.path.to_lowercase()))
            .take(MAX)
            .collect::<Vec<_>>()
    })
    .await?;
    Ok(images)
}

/// Images an agent mentioned in a message (paths found in its text by the chat), made viewable: existing image
/// files only, relative paths resolved against the chat's folder, each one opened to the asset protocol.
#[tauri::command]
pub async fn agent_images(
    app: AppHandle,
    state: State<'_, Shared>,
    thread_id: String,
    paths: Vec<String>,
) -> AppResult<Vec<crate::attachments::Attachment>> {
    let images = agent_images_inner(&state, thread_id, paths).await?;
    let scope = tauri::Manager::asset_protocol_scope(&app);
    for image in &images {
        if let Err(err) = scope.allow_file(&image.path) {
            tracing::warn!(%err, path = %image.path, "agent image not served");
        }
    }
    Ok(images)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::HeadlessSink;
    use crate::state::{AppPaths, AppState};

    fn temp_state() -> (std::path::PathBuf, Shared) {
        let dir = std::env::temp_dir().join(format!("neuron-cmd-threads-{}", uuid::Uuid::new_v4().simple()));
        let paths = AppPaths {
            data_dir: dir.clone(),
            db_path: dir.join("neuron.db"),
            neuron_home: dir.join(".neuron"),
            memory_file: dir.join(".neuron").join("memory.md"),
        };
        let state = AppState::open(paths, Arc::new(HeadlessSink), std::time::Instant::now()).unwrap();
        (dir, Arc::new(state))
    }

    #[tokio::test]
    async fn deleted_thread_rejects_send_message_and_can_be_restored() {
        let (dir, state) = temp_state();
        state
            .db
            .call(|c| {
                c.execute(
                    "INSERT INTO threads (id, agent, title, status, created_at, updated_at, cwd)
                     VALUES ('t1', 'claude_code', 'Hello', 'done', 1, 1, '.')",
                    [],
                )?;
                Ok(())
            })
            .await
            .unwrap();

        delete_thread_inner(&state, "t1".into()).await.unwrap();

        let err = send_message_inner(&state, "t1".into(), "ping".into(), None).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "expected NotFound, got {err:?}");
        let msg_count: i64 = state
            .db
            .call(|c| Ok(c.query_row("SELECT COUNT(*) FROM messages WHERE thread_id = 't1'", [], |r| r.get(0))?))
            .await
            .unwrap();
        assert_eq!(msg_count, 0, "rejected message must not be persisted");

        let restored = restore_thread_inner(&state, "t1".into()).await.unwrap();
        assert_eq!(restored.id, "t1");
        assert_eq!(restored.pinned_at, None);
        assert_eq!(restored.archived_at, None);

        let pinned = set_thread_pinned_inner(&state, "t1".into(), true).await.unwrap();
        assert!(pinned.pinned_at.is_some());
        let archived = set_thread_archived_inner(&state, "t1".into(), true).await.unwrap();
        assert!(archived.archived_at.is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
