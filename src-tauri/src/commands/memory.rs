//! Global memory: CRUD, search, file location, and the `memory.md` watcher.

use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::agents::events::AgentKind;
use crate::db::memories;
use crate::error::AppError;
use crate::error::AppResult;
use crate::memory::import::{self, ImportedMemory, LocalMemorySource, MemoryImportOrigin};
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
pub async fn search_memories(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> AppResult<Vec<MemoryHit>> {
    let limit = limit.map_or(20, |l| l as usize);
    state.db.call(move |c| memories::search(c, &query, limit)).await
}

#[tauri::command]
pub async fn memory_info(state: State<'_, AppState>) -> AppResult<MemoryInfo> {
    let launch = crate::util::neuron_exe().ok().map(|exe| {
        let paths =
            memory::MemoryPaths { db_path: state.paths.db_path.clone(), file_path: state.paths.memory_file.clone() };
        memory::mcp::McpLaunch::new(exe, &paths, "<agent>", None).display()
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
    let exe = crate::util::neuron_exe()?;
    let paths =
        memory::MemoryPaths { db_path: state.paths.db_path.clone(), file_path: state.paths.memory_file.clone() };
    Ok(memory::mcp::McpLaunch::new(exe, &paths, agent, None))
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

/// `agy mcp add neuron -- <neuron.exe> --mcp-memory …` (explicit user action from Paramètres → Agents & MCP).
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

/// Max text sent to an agent for a reformulation (it goes on a command line for Antigravity).
const MAX_REFORMULATE_CHARS: usize = 20_000;

/// Instruction files of the agent CLIs found on this computer (Claude Code, Codex, Gemini CLI).
#[tauri::command]
pub async fn memory_import_sources(app: AppHandle) -> AppResult<Vec<LocalMemorySource>> {
    let home = app.path().home_dir()?;
    Ok(tokio::task::spawn_blocking(move || import::local_sources(&home)).await?)
}

/// Text of a file to import (picked by the user or a CLI instruction file), 200 KB max.
#[tauri::command]
pub async fn read_memory_import_file(path: String) -> AppResult<String> {
    tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)?;
        if meta.len() > import::MAX_IMPORT_BYTES {
            return Err(AppError::Invalid("fichier trop gros pour un import de mémoire (200 Ko max)".into()));
        }
        Ok(String::from_utf8_lossy(&std::fs::read(&path)?).into_owned())
    })
    .await?
}

/// Split text into memories with a guessed category (preview, nothing saved).
#[tauri::command]
pub async fn split_memory_import(text: String) -> AppResult<Vec<ImportedMemory>> {
    Ok(import::split_memories(&text))
}

/// Ask an agent to rewrite the text into clean, categorized memories (preview, nothing saved).
#[tauri::command]
pub async fn reformulate_memory_import(agent: AgentKind, text: String) -> AppResult<Vec<ImportedMemory>> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::Invalid("rien à reformuler".into()));
    }
    if text.chars().count() > MAX_REFORMULATE_CHARS {
        return Err(AppError::Invalid(format!(
            "texte trop long pour une reformulation ({MAX_REFORMULATE_CHARS} caractères max) : importe-le en plusieurs fois"
        )));
    }
    let answer = crate::agents::oneshot::run(agent, &import::reformulation_prompt(text)).await?;
    import::parse_reformulated(&answer).ok_or_else(|| {
        AppError::Other("l'agent n'a pas renvoyé de souvenirs lisibles : réessaie ou importe sans reformuler".into())
    })
}

/// Save imported memories (`source = import:<origin>`); duplicates of existing memories are skipped.
/// Returns how many were added.
#[tauri::command]
pub async fn import_memories(
    state: State<'_, AppState>,
    items: Vec<ImportedMemory>,
    origin: MemoryImportOrigin,
) -> AppResult<u32> {
    let file = state.paths.memory_file.clone();
    let source = format!("import:{}", origin.as_str());
    state
        .db
        .call(move |c| {
            let now = now_ms();
            memory::import_if_changed(c, &file, now)?;
            let mut seen: std::collections::HashSet<String> =
                memories::list(c)?.iter().map(|m| import::normalize(&m.content)).collect();
            let mut added = 0u32;
            for item in &items {
                let key = import::normalize(&item.content);
                if key.is_empty() || !seen.insert(key) {
                    continue;
                }
                memories::insert(c, item.category, &item.content, &source, now)?;
                added += 1;
            }
            if added > 0 {
                memory::export(c, &file)?;
            }
            Ok(added)
        })
        .await
}
