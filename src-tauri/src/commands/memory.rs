//! Global memory: CRUD, search, file location, and the `memory.md` watcher.

use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::memories;
use crate::error::AppResult;
use crate::memory::{self, Memory, MemoryCategory, MemoryHit, MemoryInfo};
use crate::state::AppState;
use crate::util::now_ms;

/// Event emitted when the memory changed outside the frontend's own calls (file edit, agent via MCP).
pub const MEMORY_CHANGED_EVENT: &str = "memory://changed";

#[tauri::command]
pub async fn list_memories(state: State<'_, AppState>) -> AppResult<Vec<Memory>> {
    let file = state.paths.memory_file.clone();
    state
        .db
        .call(move |c| {
            memory::import_if_changed(c, &file, now_ms())?;
            memories::list(c)
        })
        .await
}

#[tauri::command]
pub async fn create_memory(state: State<'_, AppState>, category: MemoryCategory, content: String) -> AppResult<Memory> {
    let file = state.paths.memory_file.clone();
    state
        .db
        .call(move |c| {
            memory::import_if_changed(c, &file, now_ms())?;
            let saved = memories::insert(c, category, &content, "user", now_ms())?;
            memory::export(c, &file)?;
            Ok(saved)
        })
        .await
}

#[tauri::command]
pub async fn update_memory(
    state: State<'_, AppState>,
    id: String,
    category: MemoryCategory,
    content: String,
) -> AppResult<Memory> {
    let file = state.paths.memory_file.clone();
    state
        .db
        .call(move |c| {
            let saved = memories::update(c, &id, category, &content, now_ms())?;
            memory::export(c, &file)?;
            Ok(saved)
        })
        .await
}

#[tauri::command]
pub async fn delete_memory(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let file = state.paths.memory_file.clone();
    state
        .db
        .call(move |c| {
            memories::delete(c, &id)?;
            memory::export(c, &file)
        })
        .await
}

#[tauri::command]
pub async fn search_memories(state: State<'_, AppState>, query: String, limit: Option<u32>) -> AppResult<Vec<MemoryHit>> {
    let limit = limit.map_or(20, |l| l as usize);
    state.db.call(move |c| memories::search(c, &query, limit)).await
}

#[tauri::command]
pub async fn memory_info(state: State<'_, AppState>) -> AppResult<MemoryInfo> {
    let launch = std::env::current_exe().ok().map(|exe| {
        let paths = memory::MemoryPaths {
            db_path: state.paths.db_path.clone(),
            file_path: state.paths.memory_file.clone(),
        };
        memory::mcp::McpLaunch::new(exe, &paths, "<agent>").display()
    });
    Ok(MemoryInfo {
        file_path: state.paths.memory_file.display().to_string(),
        mcp_enabled: launch.is_some(),
        mcp_command: launch.unwrap_or_default(),
    })
}

/// Open `memory.md` with the default editor.
#[tauri::command]
pub async fn open_memory_file(state: State<'_, AppState>) -> AppResult<()> {
    let path = state.paths.memory_file.clone();
    let opener = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener).arg(&path).spawn()?;
    Ok(())
}

fn modified(path: &std::path::Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Poll `memory.md` (cheap `stat` every 2 s): import outside edits and tell the frontend.
pub fn spawn_memory_watcher(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else { return };
        let file = state.paths.memory_file.clone();
        let db = state.db.clone();
        let mut last = modified(&file);
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let now = modified(&file);
            if now == last {
                continue;
            }
            last = now;
            let f = file.clone();
            match db.call(move |c| memory::import_if_changed(c, &f, now_ms())).await {
                Ok(_) => {
                    if let Err(err) = app.emit(MEMORY_CHANGED_EVENT, ()) {
                        tracing::warn!(%err, "emit memory change failed");
                    }
                }
                Err(err) => tracing::warn!(%err, "memory.md import failed"),
            }
        }
    });
}

/// Antigravity can't take an MCP server per session: it must be registered once in its own config.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AgyMcpStatus {
    /// `agy` not found.
    Unavailable,
    NotConnected,
    Connected,
    /// Registered with another executable/database (e.g. dev build vs installed app): reconnect.
    Outdated,
}

fn launch_for(state: &AppState, agent: &str) -> AppResult<memory::mcp::McpLaunch> {
    let exe = std::env::current_exe()?;
    let paths = memory::MemoryPaths { db_path: state.paths.db_path.clone(), file_path: state.paths.memory_file.clone() };
    Ok(memory::mcp::McpLaunch::new(exe, &paths, agent))
}

async fn agy_status(state: &AppState) -> AppResult<AgyMcpStatus> {
    let Some(list) = crate::agents::catalog::run_cli("agy", &["mcp", "list"]).await else {
        return Ok(AgyMcpStatus::Unavailable);
    };
    let name = memory::mcp::SERVER_NAME;
    let Some(line) = list.lines().find(|l| l.split_whitespace().next() == Some(name)) else {
        return Ok(AgyMcpStatus::NotConnected);
    };
    let launch = launch_for(state, "antigravity")?;
    let norm = |s: &str| s.replace('\\', "/").to_lowercase();
    let ok = norm(line).contains(&norm(&launch.command.display().to_string()))
        && norm(line).contains(&norm(&state.paths.db_path.display().to_string()));
    Ok(if ok { AgyMcpStatus::Connected } else { AgyMcpStatus::Outdated })
}

#[tauri::command]
pub async fn antigravity_mcp_status(state: State<'_, AppState>) -> AppResult<AgyMcpStatus> {
    agy_status(&state).await
}

/// `agy mcp add neuron -- <neuron.exe> --mcp-memory …` (explicit user action from the Memory view).
#[tauri::command]
pub async fn connect_antigravity_mcp(state: State<'_, AppState>) -> AppResult<AgyMcpStatus> {
    let launch = launch_for(&state, "antigravity")?;
    let exe = launch.command.display().to_string();
    let mut args: Vec<&str> = vec!["mcp", "add", memory::mcp::SERVER_NAME, "--", &exe];
    args.extend(launch.args.iter().map(String::as_str));
    if crate::agents::catalog::run_cli("agy", &args).await.is_none() {
        return Err(crate::error::AppError::Other("« agy mcp add » a échoué".into()));
    }
    tracing::info!("memory MCP server registered in Antigravity");
    agy_status(&state).await
}

#[tauri::command]
pub async fn disconnect_antigravity_mcp(state: State<'_, AppState>) -> AppResult<AgyMcpStatus> {
    crate::agents::catalog::run_cli("agy", &["mcp", "remove", memory::mcp::SERVER_NAME]).await;
    agy_status(&state).await
}
