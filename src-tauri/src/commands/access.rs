//! Agent CLIs: installed? signed in? — and the « Installer » / « Se connecter » actions.

use crate::agents::access::{self, AgentAccess};
use crate::agents::events::AgentKind;
use crate::error::AppResult;

/// State of every managed agent (cached 2 min unless `refresh`).
#[tauri::command]
pub async fn agent_access(refresh: Option<bool>) -> AppResult<Vec<AgentAccess>> {
    Ok(access::list(refresh.unwrap_or(false)).await)
}

/// Fresh state of one agent (polled after an install / sign-in).
#[tauri::command]
pub async fn check_agent_access(agent: AgentKind) -> AppResult<AgentAccess> {
    access::check(agent).await
}

/// Opens a PowerShell window running the agent's official installer.
#[tauri::command]
pub async fn install_agent(agent: AgentKind) -> AppResult<()> {
    access::install(agent)
}

/// Opens a PowerShell window running the agent's sign-in.
#[tauri::command]
pub async fn login_agent(agent: AgentKind) -> AppResult<()> {
    access::login(agent)
}
