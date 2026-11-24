//! Mission Control, Live Dock and palette data. Everything comes from local SQLite.

use std::time::Instant;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::projects::{self, ProjectSummary};
use crate::db::providers::{self, AgentLiveQuotas, ProviderUpdate, ProviderUsage};
use crate::db::threads::{self, ThreadSummary};
use crate::db::usage::{self, UsageRange, UsageReport};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util::now_ms;

/// Everything the home screen needs, in one round-trip.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DashboardSnapshot {
    pub providers: Vec<ProviderUsage>,
    pub usage: UsageReport,
    pub active_threads: Vec<ThreadSummary>,
    pub recent_threads: Vec<ThreadSummary>,
    pub projects: Vec<ProjectSummary>,
    /// Subscription windows reported by each agent (5 h / weekly / 30 days).
    pub live_quotas: Vec<AgentLiveQuotas>,
    /// Time spent in SQLite building this snapshot, in microseconds.
    #[ts(type = "number")]
    pub query_us: i64,
}

const RECENT_LIMIT: u32 = 12;

#[tauri::command]
pub async fn dashboard_snapshot(state: State<'_, AppState>, range: Option<UsageRange>) -> AppResult<DashboardSnapshot> {
    let range = range.unwrap_or(UsageRange::Week);
    state
        .db
        .call(move |conn| {
            let started = Instant::now();
            let now = now_ms();
            let providers = providers::list_with_usage(conn, now)?;
            let usage = usage::report(conn, range, now)?;
            let active_threads = threads::list_active(conn)?;
            let recent_threads = threads::list_recent(conn, RECENT_LIMIT)?;
            let projects = projects::list(conn)?;
            let live_quotas = providers::live_quotas(conn)?;
            Ok(DashboardSnapshot {
                providers,
                usage,
                active_threads,
                recent_threads,
                projects,
                live_quotas,
                query_us: i64::try_from(started.elapsed().as_micros()).unwrap_or(i64::MAX),
            })
        })
        .await
}

#[tauri::command]
pub async fn usage_report(state: State<'_, AppState>, range: UsageRange) -> AppResult<UsageReport> {
    state.db.call(move |conn| usage::report(conn, range, now_ms())).await
}

#[tauri::command]
pub async fn update_provider(state: State<'_, AppState>, update: ProviderUpdate) -> AppResult<ProviderUsage> {
    state
        .db
        .call(move |conn| {
            let now = now_ms();
            providers::update(conn, &update, now)?;
            let provider = providers::get(conn, &update.id)?
                .ok_or_else(|| AppError::NotFound(crate::tr!("provider {}", "provider {}", update.id)))?;
            providers::usage(conn, provider, now)
        })
        .await
}

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<ProjectSummary>> {
    state.db.call(|conn| projects::list(conn)).await
}

#[tauri::command]
pub async fn list_threads(state: State<'_, AppState>, limit: Option<u32>) -> AppResult<Vec<ThreadSummary>> {
    let limit = limit.unwrap_or(50).min(500);
    state.db.call(move |conn| threads::list_recent(conn, limit)).await
}

#[tauri::command]
pub async fn get_thread(state: State<'_, AppState>, id: String) -> AppResult<ThreadSummary> {
    state.db.call(move |conn| threads::get(conn, &id)?.ok_or_else(|| AppError::NotFound(format!("thread {id}")))).await
}
