//! Thread summaries for the Live Dock, the palette and recent activity.

use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::events::{AgentKind, ThreadStatus};
use crate::error::{AppError, AppResult};

/// Soft-deleted threads stay restorable for this long before background purge removes them.
pub const DELETE_RETENTION_MS: i64 = 30_000;

/// Remote device whose files and terminal a chat operates on (when different from the AI host).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorkspaceTarget {
    pub device_id: String,
    pub device_name: String,
    pub cwd: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub os: Option<String>,
}

/// Runtime metadata for a cross-device workspace chat (includes the optional reverse-channel grant id).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRuntime {
    pub target: WorkspaceTarget,
    pub grant_id: Option<String>,
}

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
    #[ts(type = "number | null")]
    pub pinned_at: Option<i64>,
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
    /// input + output tokens consumed by this thread.
    #[ts(type = "number")]
    pub tokens: i64,
    pub cost_usd: f64,
    /// Working directory of the agent process.
    pub cwd: Option<String>,
    pub permission_mode: String,
    /// Reasoning effort (None = CLI default).
    pub effort: Option<String>,
    /// A project context was injected when the chat was created.
    pub has_context: bool,
    /// Remote workspace target when this chat's AI acts on another paired device.
    #[serde(default)]
    pub workspace: Option<WorkspaceTarget>,
}

const SELECT: &str = "SELECT t.id, t.project_id, p.name, t.agent, t.model, t.title, t.status,
            t.created_at, t.updated_at, t.ended_at, t.pinned_at, t.archived_at,
            COALESCE(u.tokens, 0), COALESCE(u.cost, 0.0), t.cwd, t.permission_mode, t.effort, t.context IS NOT NULL,
            t.workspace_device, t.workspace_device_name, t.workspace_cwd, t.workspace_project_id,
            t.workspace_project_name, t.workspace_os
     FROM threads t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN (SELECT thread_id, SUM(input_tokens + output_tokens) AS tokens, SUM(cost_usd) AS cost
                FROM token_usage WHERE thread_id IS NOT NULL GROUP BY thread_id) u ON u.thread_id = t.id";

fn workspace_from_cols(
    device_id: Option<String>,
    device_name: Option<String>,
    cwd: Option<String>,
    project_id: Option<String>,
    project_name: Option<String>,
    os: Option<String>,
) -> Option<WorkspaceTarget> {
    let device_id = device_id.filter(|s| !s.is_empty())?;
    let cwd = cwd.filter(|s| !s.is_empty())?;
    Some(WorkspaceTarget { device_id, device_name: device_name.unwrap_or_default(), cwd, project_id, project_name, os })
}

fn from_row(row: &Row<'_>) -> rusqlite::Result<ThreadSummary> {
    let workspace =
        workspace_from_cols(row.get(18)?, row.get(19)?, row.get(20)?, row.get(21)?, row.get(22)?, row.get(23)?);
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
        pinned_at: row.get(10)?,
        archived_at: row.get(11)?,
        tokens: row.get(12)?,
        cost_usd: row.get(13)?,
        cwd: row.get(14)?,
        permission_mode: row.get(15)?,
        effort: row.get(16)?,
        has_context: row.get(17)?,
        workspace,
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
    /// Frozen project context (markdown) injected into this chat.
    pub context: Option<String>,
    pub title: String,
    pub workspace: Option<WorkspaceRuntime>,
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
    pub context: Option<&'a crate::context::ContextBundle>,
    pub workspace: Option<&'a WorkspaceRuntime>,
    pub now: i64,
}

pub fn create(conn: &Connection, t: &NewThread<'_>) -> AppResult<()> {
    let ws = t.workspace;
    conn.execute(
        "INSERT INTO threads (id, project_id, agent, model, title, status, created_at, updated_at, cwd, permission_mode, effort,
                              context, context_sources, workspace_device, workspace_device_name, workspace_cwd,
                              workspace_project_id, workspace_project_name, workspace_grant_id, workspace_os)
         VALUES (?1, ?2, ?3, ?4, ?5, 'idle', ?6, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        rusqlite::params![
            t.id,
            t.project_id,
            t.agent,
            t.model,
            t.title,
            t.now,
            t.cwd,
            t.permission_mode,
            t.effort,
            t.context.map(|c| c.markdown.as_str()),
            t.context.map(|c| serde_json::to_string(&c.sources)).transpose()?,
            ws.map(|w| w.target.device_id.as_str()),
            ws.map(|w| w.target.device_name.as_str()),
            ws.map(|w| w.target.cwd.as_str()),
            ws.and_then(|w| w.target.project_id.as_deref()),
            ws.and_then(|w| w.target.project_name.as_deref()),
            ws.and_then(|w| w.grant_id.as_deref()),
            ws.and_then(|w| w.target.os.as_deref()),
        ],
    )?;
    Ok(())
}

pub fn runtime(conn: &Connection, id: &str) -> AppResult<Option<ThreadRuntime>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, agent, project_id, model, cwd, permission_mode, session_ref, title, effort, context,
                workspace_device, workspace_device_name, workspace_cwd, workspace_project_id, workspace_project_name,
                workspace_grant_id, workspace_os
         FROM threads WHERE id = ?1 AND deleted_at IS NULL",
    )?;
    Ok(stmt
        .query_row([id], |r| {
            let grant_id: Option<String> = r.get(15)?;
            let workspace = workspace_from_cols(r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?, r.get(14)?, r.get(16)?)
                .map(|target| WorkspaceRuntime { target, grant_id });
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
                context: r.get(9)?,
                workspace,
            })
        })
        .optional()?)
}

/// The context injected into a chat, if any.
pub fn context(conn: &Connection, id: &str) -> AppResult<Option<crate::context::ContextBundle>> {
    let row: Option<(Option<String>, Option<String>)> = conn
        .query_row("SELECT context, context_sources FROM threads WHERE id = ?1 AND deleted_at IS NULL", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    Ok(row.and_then(|(markdown, sources)| {
        Some(crate::context::ContextBundle {
            markdown: markdown?,
            sources: sources.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        })
    }))
}

/// Number of user messages already stored for a chat.
pub fn user_message_count(conn: &Connection, id: &str) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM messages WHERE thread_id = ?1 AND role = 'user'", [id], |r| r.get(0))?)
}

pub fn set_status(conn: &Connection, id: &str, status: ThreadStatus, now: i64) -> AppResult<()> {
    let ended = (!status.is_active()).then_some(now);
    conn.execute(
        "UPDATE threads SET status = ?2, updated_at = ?3, ended_at = ?4 WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, status, now, ended],
    )?;
    Ok(())
}

pub fn set_session(conn: &Connection, id: &str, session_ref: &str, model: Option<&str>) -> AppResult<()> {
    conn.execute(
        "UPDATE threads SET session_ref = ?2, model = COALESCE(model, ?3) WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, session_ref, model],
    )?;
    Ok(())
}

pub fn set_title_if_empty(conn: &Connection, id: &str, title: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE threads SET title = ?2 WHERE id = ?1 AND title = '' AND deleted_at IS NULL",
        rusqlite::params![id, title],
    )?;
    Ok(())
}

/// Change model / effort / permission mode (applied when the session (re)starts).
/// Mode switched by the agent itself (no restart).
pub fn set_permission_mode(conn: &Connection, id: &str, mode: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE threads SET permission_mode = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, mode],
    )?;
    Ok(())
}

pub fn update_settings(
    conn: &Connection,
    id: &str,
    model: Option<&str>,
    effort: Option<&str>,
    permission_mode: &str,
) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE threads SET model = ?2, effort = ?3, permission_mode = ?4 WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, model, effort, permission_mode],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("chat {id}")));
    }
    Ok(())
}

pub fn rename(conn: &Connection, id: &str, title: &str) -> AppResult<()> {
    conn.execute("UPDATE threads SET title = ?2 WHERE id = ?1 AND deleted_at IS NULL", rusqlite::params![id, title])?;
    Ok(())
}

pub fn set_pinned(conn: &Connection, id: &str, pinned_at: Option<i64>) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE threads SET pinned_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, pinned_at],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("chat {id}")));
    }
    Ok(())
}

pub fn set_archived(conn: &Connection, id: &str, archived_at: Option<i64>) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE threads SET archived_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, archived_at],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("chat {id}")));
    }
    Ok(())
}

/// Reassign a thread to another project (or detach it when `project_id` is `None`).
/// Only `threads.project_id` changes; the frozen context and working directory stay as they are.
pub fn move_to_project(conn: &Connection, id: &str, project_id: Option<&str>) -> AppResult<()> {
    if let Some(pid) = project_id {
        let exists = conn.query_row("SELECT 1 FROM projects WHERE id = ?1", [pid], |_| Ok(())).optional()?.is_some();
        if !exists {
            return Err(AppError::NotFound(crate::tr!("projet {pid}", "project {pid}")));
        }
    }
    let n = conn.execute(
        "UPDATE threads SET project_id = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, project_id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("chat {id}")));
    }
    Ok(())
}

/// Mark a thread as deleted (hidden from all queries; restorable until [`purge_deleted`] removes it).
/// Any active status is cancelled and dangling running tools are closed since its agent has been shut down.
pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> AppResult<()> {
    crate::db::chat::close_dangling_tools(conn, id, now)?;
    let sql = format!(
        "UPDATE threads
         SET deleted_at = ?2,
             status = CASE WHEN status IN ({active}) THEN 'cancelled' ELSE status END,
             ended_at = CASE WHEN status IN ({active}) THEN COALESCE(ended_at, ?2) ELSE ended_at END
         WHERE id = ?1 AND deleted_at IS NULL",
        active = ThreadStatus::active_sql_list()
    );
    conn.execute(&sql, rusqlite::params![id, now])?;
    Ok(())
}

/// Undo a soft deletion. Fails with [`AppError::NotFound`] if the thread was already purged.
pub fn restore(conn: &Connection, id: &str) -> AppResult<()> {
    let n = conn.execute("UPDATE threads SET deleted_at = NULL WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::NotFound(crate::tr!(
            "ce chat a déjà été définitivement supprimé",
            "this chat has already been permanently deleted"
        )));
    }
    Ok(())
}

/// Permanently remove a thread (cascades to messages / tool_calls; token_usage keeps rows with thread_id = NULL).
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM threads WHERE id = ?1", [id])?;
    Ok(())
}

/// Permanently delete every soft-deleted thread whose `deleted_at` is at or before `cutoff` (Unix ms).
pub fn purge_deleted(conn: &Connection, cutoff: i64) -> AppResult<usize> {
    let ids: Vec<String> = {
        let mut stmt =
            conn.prepare_cached("SELECT id FROM threads WHERE deleted_at IS NOT NULL AND deleted_at <= ?1")?;
        let rows = stmt.query_map([cutoff], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    for id in &ids {
        delete(conn, id)?;
    }
    Ok(ids.len())
}

/// At startup no agent process is alive: threads left "active" by a previous run become idle.
pub fn reset_stale_active(conn: &Connection, now: i64) -> AppResult<usize> {
    let sql = format!(
        "UPDATE threads SET status = 'idle', updated_at = ?1, ended_at = ?1 WHERE deleted_at IS NULL AND status IN ({})",
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
    let mut stmt =
        conn.prepare_cached(&format!("{SELECT} WHERE t.deleted_at IS NULL ORDER BY t.updated_at DESC LIMIT ?1"))?;
    let rows = stmt.query_map([limit], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn list_active(conn: &Connection) -> AppResult<Vec<ThreadSummary>> {
    let sql = format!(
        "{SELECT} WHERE t.deleted_at IS NULL AND t.status IN ({}) ORDER BY t.updated_at DESC",
        ThreadStatus::active_sql_list()
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<ThreadSummary>> {
    let mut stmt = conn.prepare_cached(&format!("{SELECT} WHERE t.id = ?1 AND t.deleted_at IS NULL"))?;
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

    #[tokio::test]
    async fn delete_drops_history_but_keeps_usage() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            conn.execute_batch(
                "INSERT INTO threads (id, project_id, agent, title, status, created_at, updated_at)
                   VALUES ('t1', NULL, 'claude_code', 'Old', 'done', 1, 5);
                 INSERT INTO messages (id, thread_id, seq, role, content, created_at) VALUES ('m1', 't1', 1, 'user', 'hi', 1);
                 INSERT INTO tool_calls (id, thread_id, name, started_at) VALUES ('c1', 't1', 'Bash', 1);
                 INSERT INTO token_usage (thread_id, agent, input_tokens, output_tokens, cost_usd, ts)
                   VALUES ('t1', 'claude_code', 100, 20, 0.1, 1);",
            )?;
            delete(conn, "t1")?;
            assert!(get(conn, "t1")?.is_none());
            let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0));
            assert_eq!(count("SELECT COUNT(*) FROM messages")?, 0);
            assert_eq!(count("SELECT COUNT(*) FROM tool_calls")?, 0);
            // The dashboard keeps what the chat cost.
            assert_eq!(count("SELECT COUNT(*) FROM token_usage WHERE thread_id IS NULL")?, 1);
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn pin_archive_and_move_preserve_context_and_cwd() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            conn.execute_batch(
                "INSERT INTO projects (id, name, path, created_at) VALUES
                   ('p1', 'Alpha', '/alpha', 1),
                   ('p2', 'Beta', '/beta', 2);
                 INSERT INTO threads (id, project_id, agent, title, status, created_at, updated_at, cwd, context, context_sources)
                   VALUES ('t1', 'p1', 'claude_code', 'Chat', 'done', 10, 20, '/alpha', '# frozen', '[]');",
            )?;

            // Pin & archive expose timestamps without hiding archived chats from list_recent.
            set_pinned(conn, "t1", Some(100))?;
            set_archived(conn, "t1", Some(200))?;
            let t = get(conn, "t1")?.unwrap();
            assert_eq!((t.pinned_at, t.archived_at), (Some(100), Some(200)));
            assert_eq!(list_recent(conn, 10)?.len(), 1, "archived chats stay listed");

            set_pinned(conn, "t1", None)?;
            set_archived(conn, "t1", None)?;
            let t = get(conn, "t1")?.unwrap();
            assert_eq!((t.pinned_at, t.archived_at), (None, None));

            // Move changes only project_id; cwd and frozen context stay untouched.
            move_to_project(conn, "t1", Some("p2"))?;
            let t = get(conn, "t1")?.unwrap();
            assert_eq!(t.project_id.as_deref(), Some("p2"));
            assert_eq!(t.project_name.as_deref(), Some("Beta"));
            assert_eq!(t.cwd.as_deref(), Some("/alpha"));
            assert_eq!(context(conn, "t1")?.map(|c| c.markdown).as_deref(), Some("# frozen"));

            // Detaching from any project works too.
            move_to_project(conn, "t1", None)?;
            assert_eq!(get(conn, "t1")?.unwrap().project_id, None);
            assert_eq!(get(conn, "t1")?.unwrap().cwd.as_deref(), Some("/alpha"));

            // Missing project or missing thread returns NotFound.
            assert!(matches!(move_to_project(conn, "t1", Some("missing")), Err(AppError::NotFound(_))));
            assert!(matches!(set_pinned(conn, "missing", Some(1)), Err(AppError::NotFound(_))));
            assert!(matches!(set_archived(conn, "missing", Some(1)), Err(AppError::NotFound(_))));
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn soft_delete_restore_and_purge_after_30s() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            conn.execute_batch(
                "INSERT INTO projects (id, name, path, created_at) VALUES ('p1', 'Neuron', '/n', 1);
                 INSERT INTO threads (id, project_id, agent, title, status, created_at, updated_at) VALUES
                   ('t1', 'p1', 'claude_code', 'Active chat', 'thinking', 10, 50),
                   ('t2', 'p1', 'codex', 'Other chat', 'done', 10, 60);
                 INSERT INTO messages (id, thread_id, seq, role, content, created_at)
                   VALUES ('m1', 't1', 1, 'user', 'bonjour', 11);
                 INSERT INTO tool_calls (id, thread_id, name, status, started_at)
                   VALUES ('c1', 't1', 'Bash', 'running', 12);
                 INSERT INTO token_usage (thread_id, agent, input_tokens, output_tokens, cost_usd, ts)
                   VALUES ('t1', 'claude_code', 50, 10, 0.05, 13);",
            )?;

            // Soft delete hides the thread from lists, lookups, runtime, history and project counts.
            soft_delete(conn, "t1", 1_000)?;
            assert!(get(conn, "t1")?.is_none());
            assert!(runtime(conn, "t1")?.is_none());
            assert!(list_active(conn)?.is_empty());
            assert_eq!(list_recent(conn, 10)?.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t2"]);
            assert!(crate::db::chat::history(conn, "t1")?.is_empty());
            let proj = crate::db::projects::get(conn, "p1")?.unwrap();
            assert_eq!((proj.thread_count, proj.active_count), (1, 0));

            // Restore makes it visible again with its history, and active status was cleanly cancelled.
            restore(conn, "t1")?;
            let restored = get(conn, "t1")?.unwrap();
            assert_eq!(restored.status, ThreadStatus::Cancelled);
            assert_eq!(restored.updated_at, 50);
            assert_eq!(crate::db::chat::history(conn, "t1")?.len(), 2);
            let proj = crate::db::projects::get(conn, "p1")?.unwrap();
            assert_eq!((proj.thread_count, proj.active_count), (2, 0));

            // Soft delete again and test purge threshold (30 s).
            soft_delete(conn, "t1", 10_000)?;
            assert_eq!(purge_deleted(conn, 10_000 + DELETE_RETENTION_MS - 1 - DELETE_RETENTION_MS)?, 0);
            assert_eq!(purge_deleted(conn, 9_999)?, 0, "deleted at 10_000 is newer than cutoff 9_999");
            assert_eq!(purge_deleted(conn, 10_000)?, 1, "deleted at 10_000 is purged once 30 s elapsed");

            // After purge, messages & tool_calls are gone, usage row kept with NULL thread_id, restore errors.
            let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0));
            assert_eq!(count("SELECT COUNT(*) FROM threads WHERE id = 't1'")?, 0);
            assert_eq!(count("SELECT COUNT(*) FROM messages WHERE thread_id = 't1'")?, 0);
            assert_eq!(count("SELECT COUNT(*) FROM tool_calls WHERE thread_id = 't1'")?, 0);
            assert_eq!(count("SELECT COUNT(*) FROM token_usage WHERE thread_id IS NULL")?, 1);
            assert!(matches!(restore(conn, "t1"), Err(AppError::NotFound(_))));
            Ok(())
        })
        .await
        .unwrap();
    }
}
