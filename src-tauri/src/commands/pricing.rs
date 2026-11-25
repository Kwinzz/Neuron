//! Model prices (LiteLLM list, cached daily) for the dollar cost of Codex/Antigravity requests.

use tauri::{AppHandle, Manager, State};

use crate::error::AppResult;
use crate::pricing::{self, PricingStatus};
use crate::state::AppState;
use crate::util::now_ms;

#[tauri::command]
pub async fn pricing_status() -> AppResult<PricingStatus> {
    Ok(pricing::status())
}

/// Download the latest prices now, then price past requests that were still at $0.
#[tauri::command]
pub async fn refresh_prices(state: State<'_, AppState>) -> AppResult<PricingStatus> {
    let status = pricing::refresh(&state.paths.data_dir, now_ms()).await?;
    backfill(&state).await;
    Ok(status)
}

async fn backfill(state: &AppState) {
    match state.db.call(|c| pricing::backfill(c)).await {
        Ok(n) if n > 0 => tracing::info!(rows = n, "past requests priced"),
        Ok(_) => {}
        Err(err) => tracing::warn!(%err, "pricing backfill failed"),
    }
}

/// Startup: cached prices immediately, a download when the cache is older than a day (never blocks the UI).
/// Antigravity quotas: shortly after startup, then every 5 min (`agy --print /quota`, no token used), so usage
/// from outside Neuron (terminal, IDE) shows up too.
pub fn spawn_agy_quota_refresh(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        loop {
            if let Some(state) = app.try_state::<AppState>() {
                crate::agents::antigravity::quota::refresh(state.db.clone(), app.clone()).await;
            }
            tokio::time::sleep(std::time::Duration::from_secs(5 * 60)).await;
        }
    });
}

pub fn spawn_price_refresh(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else { return };
        let data_dir = state.paths.data_dir.clone();
        let due = tokio::task::spawn_blocking({
            let dir = data_dir.clone();
            move || pricing::load_cache(&dir, now_ms())
        })
        .await
        .unwrap_or(true);
        backfill(&state).await;
        if due && pricing::refresh(&data_dir, now_ms()).await.is_ok() {
            backfill(&state).await;
        }
    });
}
