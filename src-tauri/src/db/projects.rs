//! Project summaries (creation/import arrives in Phase 3).

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::agents::events::ThreadStatus;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub last_opened_at: Option<i64>,
    pub thread_count: u32,
    pub active_count: u32,
}

pub fn list(conn: &Connection) -> AppResult<Vec<ProjectSummary>> {
    let sql = format!(
        "SELECT p.id, p.name, p.path, p.created_at, p.last_opened_at,
                COUNT(t.id),
                COUNT(CASE WHEN t.status IN ({}) THEN 1 END)
         FROM projects p LEFT JOIN threads t ON t.project_id = p.id
         GROUP BY p.id
         ORDER BY COALESCE(p.last_opened_at, p.created_at) DESC",
        ThreadStatus::active_sql_list()
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map([], |r| {
        Ok(ProjectSummary {
            id: r.get(0)?,
            name: r.get(1)?,
            path: r.get(2)?,
            created_at: r.get(3)?,
            last_opened_at: r.get(4)?,
            thread_count: r.get(5)?,
            active_count: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}
