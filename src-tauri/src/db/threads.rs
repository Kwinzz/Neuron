//! Thread summaries for the Live Dock, the palette and recent activity.

use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;
use ts_rs::TS;

use crate::agents::events::{AgentKind, ThreadStatus};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadSummary {
    pub id: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub agent: AgentKind,
    pub model: Option<String>,
    pub title: String,
    pub status: ThreadStatus,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    #[ts(type = "number | null")]
    pub ended_at: Option<i64>,
    /// input + output tokens consumed by this thread.
    #[ts(type = "number")]
    pub tokens: i64,
    pub cost_usd: f64,
    /// Working directory of the agent process.
    pub cwd: Option<String>,
    pub permission_mode: String,
    /// Reasoning effort (None = CLI default).
    pub effort: Option<String>,
}

const SELECT: &str = "SELECT t.id, t.project_id, p.name, t.agent, t.model, t.title, t.status,
            t.created_at, t.updated_at, t.ended_at,
            COALESCE(u.tokens, 0), COALESCE(u.cost, 0.0), t.cwd, t.permission_mode, t.effort
     FROM threads t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN (SELECT thread_id, SUM(input_tokens + output_tokens) AS tokens, SUM(cost_usd) AS cost
                FROM token_usage WHERE thread_id IS NOT NULL GROUP BY thread_id) u ON u.thread_id = t.id";

fn from_row(row: &Row<'_>) -> rusqlite::Result<ThreadSummary> {
    Ok(ThreadSummary {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        agent: row.get(3)?,
        model: row.get(4)?,
        title: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        ended_at: row.get(9)?,
        tokens: row.get(10)?,
        cost_usd: row.get(11)?,
        cwd: row.get(12)?,
        permission_mode: row.get(13)?,
        effort: row.get(14)?,
    })
}

/// Fields needed to (re)start a session.
#[derive(Debug, Clone)]
pub struct ThreadRuntime {
    pub id: String,
    pub agent: AgentKind,
    pub project_id: Option<String>,
    pub model: Option<String>,
    pub cwd: Option<String>,
    pub permission_mode: String,
    pub effort: Option<String>,
    pub session_ref: Option<String>,
    pub title: String,
}

pub struct NewThread<'a> {
    pub id: &'a str,
    pub agent: AgentKind,
    pub project_id: Option<&'a str>,
    pub model: Option<&'a str>,
    pub title: &'a str,
    pub cwd: &'a str,
    pub permission_mode: &'a str,
    pub effort: Option<&'a str>,
    pub now: i64,
}

pub fn create(conn: &Connection, t: &NewThread<'_>) -> AppResult<()> {
    conn.execute(
        "INSERT INTO threads (id, project_id, agent, model, title, status, created_at, updated_at, cwd, permission_mode, effort)
         VALUES (?1, ?2, ?3, ?4, ?5, 'idle', ?6, ?6, ?7, ?8, ?9)",
        rusqlite::params![t.id, t.project_id, t.agent, t.model, t.title, t.now, t.cwd, t.permission_mode, t.effort],
    )?;
    Ok(())
}

pub fn runtime(conn: &Connection, id: &str) -> AppResult<Option<ThreadRuntime>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, agent, project_id, model, cwd, permission_mode, session_ref, title, effort FROM threads WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row([id], |r| {
            Ok(ThreadRuntime {
                id: r.get(0)?,
                agent: r.get(1)?,
                project_id: r.get(2)?,
                model: r.get(3)?,
                cwd: r.get(4)?,
                permission_mode: r.get(5)?,
                session_ref: r.get(6)?,
                title: r.get(7)?,
                effort: r.get(8)?,
            })
        })
        .optional()?)
}

pub fn set_status(conn: &Connection, id: &str, status: ThreadStatus, now: i64) -> AppResult<()> {
    let ended = (!status.is_active()).then_some(now);
    conn.execute(
        "UPDATE threads SET status = ?2, updated_at = ?3, ended_at = ?4 WHERE id = ?1",
        rusqlite::params![id, status, now, ended],
    )?;
    Ok(())
}

pub fn set_session(conn: &Connection, id: &str, session_ref: &str, model: Option<&str>) -> AppResult<()> {
    conn.execute(
        "UPDATE threads SET session_ref = ?2, model = COALESCE(model, ?3) WHERE id = ?1",
        rusqlite::params![id, session_ref, model],
    )?;
    Ok(())
}

pub fn set_title_if_empty(conn: &Connection, id: &str, title: &str) -> AppResult<()> {
    conn.execute("UPDATE threads SET title = ?2 WHERE id = ?1 AND title = ''", rusqlite::params![id, title])?;
    Ok(())
}

/// Change model / effort / permission mode (applied when the session (re)starts).
pub fn update_settings(
    conn: &Connection,
    id: &str,
    model: Option<&str>,
    effort: Option<&str>,
    permission_mode: &str,
) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE threads SET model = ?2, effort = ?3, permission_mode = ?4 WHERE id = ?1",
        rusqlite::params![id, model, effort, permission_mode],
    )?;
    if n == 0 {
        return Err(crate::error::AppError::NotFound(format!("chat {id}")));
    }
    Ok(())
}

pub fn rename(conn: &Connection, id: &str, title: &str) -> AppResult<()> {
    conn.execute("UPDATE threads SET title = ?2 WHERE id = ?1", rusqlite::params![id, title])?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM threads WHERE id = ?1", [id])?;
    Ok(())
}

/// At startup no agent process is alive: threads left "active" by a previous run become idle.
pub fn reset_stale_active(conn: &Connection, now: i64) -> AppResult<usize> {
    let sql = format!(
        "UPDATE threads SET status = 'idle', updated_at = ?1, ended_at = ?1 WHERE status IN ({})",
        ThreadStatus::active_sql_list()
    );
    let n = conn.execute(&sql, [now])?;
    conn.execute(
        "UPDATE tool_calls SET status = 'error', ended_at = ?1, output = COALESCE(output, 'Interrompu (Neuron fermé)')
         WHERE status = 'running'",
        [now],
    )?;
    Ok(n)
}

pub fn list_recent(conn: &Connection, limit: u32) -> AppResult<Vec<ThreadSummary>> {
    let mut stmt = conn.prepare_cached(&format!("{SELECT} ORDER BY t.updated_at DESC LIMIT ?1"))?;
    let rows = stmt.query_map([limit], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn list_active(conn: &Connection) -> AppResult<Vec<ThreadSummary>> {
    let sql = format!(
        "{SELECT} WHERE t.status IN ({}) ORDER BY t.updated_at DESC",
        ThreadStatus::active_sql_list()
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<ThreadSummary>> {
    let mut stmt = conn.prepare_cached(&format!("{SELECT} WHERE t.id = ?1"))?;
    Ok(stmt.query_row([id], from_row).optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[tokio::test]
    async fn summaries_join_project_and_tokens() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            conn.execute_batch(
                "INSERT INTO projects (id, name, path, created_at) VALUES ('p1', 'Neuron', '/n', 0);
                 INSERT INTO threads (id, project_id, agent, title, status, created_at, updated_at)
                   VALUES ('t1', 'p1', 'claude_code', 'Refactor', 'editing', 1, 5),
                          ('t2', NULL, 'codex', 'Tests', 'done', 1, 9);
                 INSERT INTO token_usage (thread_id, agent, input_tokens, output_tokens, cost_usd, ts)
                   VALUES ('t1', 'claude_code', 100, 20, 0.1, 1), ('t1', 'claude_code', 5, 5, 0.1, 2);",
            )?;
            let recent = list_recent(conn, 10)?;
            assert_eq!(recent.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t2", "t1"]);

            let active = list_active(conn)?;
            assert_eq!(active.len(), 1);
            let t1 = &active[0];
            assert_eq!(t1.project_name.as_deref(), Some("Neuron"));
            assert_eq!(t1.status, ThreadStatus::Editing);
            assert_eq!(t1.tokens, 130);

            assert!(get(conn, "missing")?.is_none());
            assert_eq!(get(conn, "t2")?.unwrap().agent, AgentKind::Codex);
            Ok(())
        })
        .await
        .unwrap();
    }
}
