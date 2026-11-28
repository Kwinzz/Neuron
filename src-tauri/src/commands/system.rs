//! System / diagnostics commands.

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::migrations;
use crate::error::{AppError, AppResult};
use crate::state::Shared;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub schema_version: u32,
    pub latest_schema_version: u32,
    pub table_count: u32,
    #[ts(type = "number")]
    pub setup_ms: u64,
    #[ts(type = "number")]
    pub db_open_us: u64,
    pub db_path: String,
    pub data_dir: String,
    pub neuron_home: String,
}

/// Basic runtime information, read from local state and SQLite only.
#[tauri::command]
pub async fn app_info(state: State<'_, Shared>) -> AppResult<AppInfo> {
    let (schema_version, table_count) = state
        .db
        .call(|conn| {
            let version = migrations::current_version(conn)?;
            let tables: u32 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts_%'",
                [],
                |r| r.get(0),
            )?;
            Ok((version, tables))
        })
        .await?;

    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version,
        latest_schema_version: migrations::LATEST_VERSION,
        table_count,
        setup_ms: state.setup_ms,
        db_open_us: state.db_open_us,
        db_path: state.paths.db_path.display().to_string(),
        data_dir: state.paths.data_dir.display().to_string(),
        neuron_home: state.paths.neuron_home.display().to_string(),
    })
}

/// Open a folder (a project's, a chat's working directory) in the system file manager.
#[tauri::command]
pub async fn open_folder(path: String) -> AppResult<()> {
    let dir = std::path::PathBuf::from(&path);
    // Folders only: never hand an arbitrary file or URL to the system opener.
    if !tokio::fs::metadata(&dir).await.is_ok_and(|m| m.is_dir()) {
        return Err(AppError::NotFound(crate::tr!("dossier introuvable : {path}", "folder not found: {path}")));
    }
    crate::util::open_with_system(&dir)?;
    Ok(())
}

/// Open a web link from a chat (Markdown answer) in the default browser. Web and mail links only: never a file,
/// a program or another scheme handed to the system opener.
#[tauri::command]
pub async fn open_link(url: String) -> AppResult<()> {
    let parsed = tauri::Url::parse(url.trim())
        .map_err(|_| AppError::Other(crate::tr!("lien invalide : {url}", "invalid link: {url}")))?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err(AppError::Other(crate::tr!("lien non pris en charge : {url}", "unsupported link: {url}")));
    }
    crate::util::open_url(parsed.as_str())?;
    Ok(())
}

/// Frontend diagnostics (uncaught errors, error boundary) forwarded to the backend log.
#[tauri::command]
pub fn frontend_log(level: String, message: String) {
    let message: String = message.chars().take(4000).collect();
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", "{message}"),
        "warn" => tracing::warn!(target: "frontend", "{message}"),
        _ => tracing::info!(target: "frontend", "{message}"),
    }
}

/// Native notification under Neuron's own name and icon (see [`crate::notifications`]).
/// `thread_id` comes back on `notification://clicked` when the user clicks it.
#[tauri::command]
pub async fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    thread_id: Option<String>,
) -> AppResult<()> {
    tokio::task::spawn_blocking(move || crate::notifications::show(&app, &title, &body, thread_id)).await?
}

/// Brings Neuron's main window up on a chat (quick prompt « envoyer et ouvrir »).
#[tauri::command]
pub async fn show_thread(app: tauri::AppHandle, thread_id: String) -> AppResult<()> {
    use tauri::Emitter;
    crate::desktop::show_main(&app);
    app.emit_to("main", crate::notifications::CLICKED_EVENT, Some(thread_id))?;
    Ok(())
}

/// Emitted to the main window: open the « Nouveau chat » screen; payload = project id (or null).
pub const NEW_CHAT_EVENT: &str = "quick://new-chat";

/// Brings Neuron's main window up on the « Nouveau chat » screen, in a project or not (quick prompt).
#[tauri::command]
pub async fn show_new_chat(app: tauri::AppHandle, project_id: Option<String>) -> AppResult<()> {
    use tauri::Emitter;
    crate::desktop::show_main(&app);
    app.emit_to("main", NEW_CHAT_EVENT, project_id)?;
    Ok(())
}
