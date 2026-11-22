//! Project summaries (creation/import arrives in Phase 3).

use rusqlite::{Connection, OptionalExtension, params};
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

/// Register a project for a local directory (idempotent on the path). Returns its id.
pub fn create(conn: &Connection, name: &str, path: &str, now: i64) -> AppResult<String> {
    if let Some(id) = conn
        .query_row("SELECT id FROM projects WHERE path = ?1", [path], |r| r.get::<_, String>(0))
        .optional()?
    {
        conn.execute("UPDATE projects SET last_opened_at = ?2 WHERE id = ?1", params![id, now])?;
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name, path, now],
    )?;
    Ok(id)
}

pub fn path_of(conn: &Connection, id: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT path FROM projects WHERE id = ?1", [id], |r| r.get(0))
        .optional()?)
}

pub fn touch(conn: &Connection, id: &str, now: i64) -> AppResult<()> {
    conn.execute("UPDATE projects SET last_opened_at = ?2 WHERE id = ?1", params![id, now])?;
    Ok(())
}

/// Forget a project (its chats are kept, detached from it).
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[tokio::test]
    async fn create_is_idempotent_and_delete_detaches_chats() {
        let db = Db::open_in_memory().unwrap();
        db.call(|c| {
            let a = create(c, "neuron", "C:/code/neuron", 1)?;
            let b = create(c, "neuron", "C:/code/neuron", 2)?;
            assert_eq!(a, b);
            assert_eq!(path_of(c, &a)?.as_deref(), Some("C:/code/neuron"));
            c.execute(
                "INSERT INTO threads (id, project_id, agent, title, status, created_at, updated_at) VALUES ('t', ?1, 'claude_code', '', 'idle', 0, 0)",
                [&a],
            )?;
            assert_eq!(list(c)?[0].thread_count, 1);
            delete(c, &a)?;
            assert!(list(c)?.is_empty());
            let project: Option<String> = c.query_row("SELECT project_id FROM threads WHERE id = 't'", [], |r| r.get(0))?;
            assert_eq!(project, None);
            Ok(())
        })
        .await
        .unwrap();
    }
}
