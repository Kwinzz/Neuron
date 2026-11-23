//! Paramètres: read/update the app settings, test a generic CLI, idle-shutdown reaper.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::app_settings::{self, AppSettings, GenericCliProfile};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[tauri::command]
pub async fn get_app_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    state.db.call(|c| app_settings::load(c)).await
}

/// Saves the settings and applies their desktop part (tray behaviour, global shortcut, start with Windows).
/// A shortcut that can't be registered (invalid, or taken by another app) leaves the previous settings in place.
#[tauri::command]
pub async fn update_app_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    let previous = state.db.call(|c| app_settings::load(c)).await?;
    let stored = state.db.call(move |c| app_settings::save(c, settings)).await?;
    let problems = crate::desktop::apply(&app, &stored);
    if problems.is_empty() {
        return Ok(stored);
    }
    let restore = previous.clone();
    state.db.call(move |c| app_settings::save(c, restore)).await?;
    crate::desktop::apply(&app, &previous);
    Err(AppError::Invalid(problems.join(" · ")))
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GenericCliTest {
    pub ok: bool,
    /// Output (truncated) or error message.
    pub output: String,
    #[ts(type = "number")]
    pub duration_ms: i64,
}

/// Run the profile once with a tiny prompt (in the user's home directory).
#[tauri::command]
pub async fn test_generic_cli(app: AppHandle, profile: GenericCliProfile) -> AppResult<GenericCliTest> {
    let cwd = app.path().home_dir().unwrap_or_else(|_| std::env::temp_dir());
    let started = std::time::Instant::now();
    let result = crate::agents::generic::test_profile(profile, cwd).await;
    let duration_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
    Ok(match result {
        Ok(out) => GenericCliTest { ok: true, output: out.chars().take(2000).collect(), duration_ms },
        Err(err) => GenericCliTest { ok: false, output: err.to_string(), duration_ms },
    })
}

/// Every minute, stop agent processes idle longer than `idleShutdownMinutes` (0 = never).
pub fn spawn_idle_reaper(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let Some(state) = app.try_state::<AppState>() else { continue };
            let minutes = match state.db.call(|c| app_settings::load(c)).await {
                Ok(s) => s.idle_shutdown_minutes,
                Err(_) => continue,
            };
            if minutes > 0 {
                state.agents.reap_idle(Duration::from_secs(u64::from(minutes) * 60));
            }
        }
    });
}
