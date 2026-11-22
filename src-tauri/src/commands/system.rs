//! System / diagnostics commands.

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::migrations;
use crate::error::AppResult;
use crate::state::AppState;

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
pub async fn app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
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
