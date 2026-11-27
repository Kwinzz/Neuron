//! Chat timeline persistence. Messages and tool calls share a per-thread `seq` so the timeline can be
//! rebuilt in order; the same [`ChatItem`] shape is used for history and for live updates on the frontend.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::agents::events::{AgentKind, TokenUsage};
use crate::error::AppResult;

/// One full-text search match inside a chat message (`messages_fts`).
///
/// Matched terms in [`Self::snippet`] are wrapped between `\u{2}` (start) and `\u{3}` (end) so the UI can
/// highlight them cleanly without colliding with Markdown or code; truncation uses `…`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MessageHit {
    pub thread_id: String,
    pub thread_title: String,
    pub project_id: Option<String>,
    pub agent: AgentKind,
    pub message_id: String,
    pub role: String,
    /// Excerpt around the match; matched terms are wrapped between `\u{2}` and `\u{3}` (`…` for truncation).
    pub snippet: String,
    #[ts(type = "number")]
    pub ts: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ToolStatus {
    Running,
    Ok,
    Error,
    Denied,
}

impl ToolStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolStatus::Running => "running",
            ToolStatus::Ok => "ok",
            ToolStatus::Error => "error",
            ToolStatus::Denied => "denied",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "ok" => ToolStatus::Ok,
            "error" => ToolStatus::Error,
            "denied" => ToolStatus::Denied,
            _ => ToolStatus::Running,
        }
    }
}

/// One entry of a thread timeline.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum ChatItem {
    User {
        id: String,
        text: String,
        #[ts(type = "number")]
        ts: i64,
        attachments: Vec<crate::attachments::Attachment>,
    },
    Text {
        id: String,
        text: String,
        streaming: bool,
    },
    Thinking {
        id: String,
        text: String,
        streaming: bool,
    },
    Tool {
        id: String,
        name: String,
        input: Value,
        activity: Option<String>,
        status: ToolStatus,
        output: Option<String>,
        #[ts(type = "number")]
        started_at: i64,
        #[ts(type = "number | null")]
        ended_at: Option<i64>,
        /// Files the call modified, with their diff (edit tools only).
        changes: Vec<crate::agents::file_changes::FileChange>,
    },
    /// Pending/answered permission request (live only, not persisted).
    Permission {
        id: String,
        tool_name: String,
        description: String,
        input: Value,
        state: PermissionState,
    },
    Error {
        id: String,
        message: String,
        /// Set when Neuron can offer the fix (install the CLI, sign in).
        issue: Option<crate::agents::access::AccessIssue>,
    },
    /// Output of a slash command run by the CLI itself (`/usage`, `/context`…). `name` without the slash.
    Command {
        id: String,
        name: String,
        output: String,
    },
    /// End-of-turn marker with the turn's usage.
    Turn {
        id: String,
        usage: TokenUsage,
        #[ts(type = "number | null")]
        duration_ms: Option<i64>,
        #[ts(type = "number")]
        ts: i64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PermissionState {
    Pending,
    Allowed,
    Denied,
}

/// Next sequence number shared by messages and tool calls of a thread.
pub fn next_seq(conn: &Connection, thread_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM (
             SELECT seq FROM messages WHERE thread_id = ?1
             UNION ALL SELECT seq FROM tool_calls WHERE thread_id = ?1 AND seq IS NOT NULL)",
        [thread_id],
        |r| r.get(0),
    )?)
}

/// role: user | assistant | thinking | error | turn | command
pub fn insert_message(
    conn: &Connection,
    id: &str,
    thread_id: &str,
    role: &str,
    content: &str,
    meta: Option<&Value>,
    ts: i64,
) -> AppResult<()> {
    let seq = next_seq(conn, thread_id)?;
    conn.execute(
        "INSERT INTO messages (id, thread_id, seq, role, content, meta_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, meta_json = excluded.meta_json",
        params![id, thread_id, seq, role, content, meta.map(Value::to_string), ts],
    )?;
    Ok(())
}

pub fn insert_tool_call(
    conn: &Connection,
    id: &str,
    thread_id: &str,
    name: &str,
    input: &Value,
    ts: i64,
) -> AppResult<()> {
    let seq = next_seq(conn, thread_id)?;
    conn.execute(
        "INSERT OR IGNORE INTO tool_calls (id, thread_id, name, input_json, status, started_at, seq)
         VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6)",
        params![id, thread_id, name, input.to_string(), ts, seq],
    )?;
    Ok(())
}

pub fn finish_tool_call(
    conn: &Connection,
    id: &str,
    output: &str,
    status: ToolStatus,
    changes: &[crate::agents::file_changes::FileChange],
    ts: i64,
) -> AppResult<()> {
    let changes_json = if changes.is_empty() { None } else { serde_json::to_string(changes).ok() };
    conn.execute(
        "UPDATE tool_calls SET output = ?2, status = ?3, ended_at = ?4, changes_json = ?5 WHERE id = ?1",
        params![id, output, status.as_str(), ts, changes_json],
    )?;
    Ok(())
}

/// Tool calls still marked running (e.g. process killed mid-tool) → error.
pub fn close_dangling_tools(conn: &Connection, thread_id: &str, ts: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE tool_calls SET status = 'error', ended_at = ?2, output = COALESCE(output, 'Interrompu')
         WHERE thread_id = ?1 AND status = 'running'",
        params![thread_id, ts],
    )?;
    Ok(())
}

pub fn history(conn: &Connection, thread_id: &str) -> AppResult<Vec<ChatItem>> {
    let alive = conn
        .query_row("SELECT 1 FROM threads WHERE id = ?1 AND deleted_at IS NULL", [thread_id], |_| Ok(()))
        .optional()?
        .is_some();
    if !alive {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare_cached(
        "SELECT seq, 'm' AS src, id, role, content, meta_json, created_at, NULL, NULL, NULL, NULL
           FROM messages WHERE thread_id = ?1
         UNION ALL
         SELECT seq, 't', id, name, input_json, NULL, started_at, status, output, ended_at, changes_json
           FROM tool_calls WHERE thread_id = ?1
         ORDER BY 1",
    )?;
    let rows = stmt.query_map([thread_id], |r| {
        let src: String = r.get(1)?;
        let id: String = r.get(2)?;
        if src == "t" {
            let name: String = r.get(3)?;
            let input: Value =
                r.get::<_, Option<String>>(4)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
            let (_, activity) = crate::agents::activity::tool_activity(&name, &input);
            return Ok(ChatItem::Tool {
                id,
                name,
                input,
                activity,
                status: ToolStatus::parse(&r.get::<_, String>(7)?),
                output: r.get(8)?,
                started_at: r.get(6)?,
                ended_at: r.get(9)?,
                changes: r
                    .get::<_, Option<String>>(10)?
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default(),
            });
        }
        let role: String = r.get(3)?;
        let content: String = r.get(4)?;
        let meta: Option<Value> = r.get::<_, Option<String>>(5)?.and_then(|s| serde_json::from_str(&s).ok());
        let ts: i64 = r.get(6)?;
        Ok(match role.as_str() {
            "user" => ChatItem::User {
                id,
                text: content,
                ts,
                attachments: meta
                    .as_ref()
                    .and_then(|m| m.get("attachments"))
                    .and_then(|a| serde_json::from_value(a.clone()).ok())
                    .unwrap_or_default(),
            },
            "thinking" => ChatItem::Thinking { id, text: content, streaming: false },
            "error" => ChatItem::Error {
                id,
                message: content,
                issue: meta
                    .as_ref()
                    .and_then(|m| m.get("issue"))
                    .and_then(Value::as_str)
                    .and_then(crate::agents::access::AccessIssue::parse),
            },
            "command" => ChatItem::Command {
                id,
                name: meta.as_ref().and_then(|m| m.get("name")).and_then(Value::as_str).unwrap_or_default().to_string(),
                output: content,
            },
            "turn" => {
                let meta = meta.unwrap_or(Value::Null);
                ChatItem::Turn {
                    id,
                    usage: serde_json::from_value(meta.get("usage").cloned().unwrap_or(Value::Null))
                        .unwrap_or_default(),
                    duration_ms: meta.get("durationMs").and_then(Value::as_i64),
                    ts,
                }
            }
            _ => ChatItem::Text { id, text: content, streaming: false },
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Sum of a thread's recorded usage.
pub fn thread_usage(conn: &Connection, thread_id: &str) -> AppResult<TokenUsage> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read_tokens),0),
                COALESCE(SUM(cache_write_tokens),0), COALESCE(SUM(cost_usd),0.0)
         FROM token_usage WHERE thread_id = ?1",
        [thread_id],
        |r| {
            Ok(TokenUsage {
                input: r.get::<_, i64>(0)?.max(0) as u64,
                output: r.get::<_, i64>(1)?.max(0) as u64,
                cache_read: r.get::<_, i64>(2)?.max(0) as u64,
                cache_write: r.get::<_, i64>(3)?.max(0) as u64,
                cost_usd: r.get(4)?,
            })
        },
    )?)
}

/// Last prompts sent in a thread's project (or globally), newest first, for ↑ recall in the composer.
pub fn prompt_history(conn: &Connection, project_id: Option<&str>, limit: u32) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare_cached(
        "SELECT text FROM prompt_history
         WHERE (?1 IS NULL AND project_id IS NULL) OR project_id = ?1
         GROUP BY text ORDER BY MAX(ts) DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![project_id, limit], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn record_prompt(conn: &Connection, project_id: Option<&str>, text: &str, ts: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO prompt_history (project_id, text, ts) VALUES (?1, ?2, ?3)",
        params![project_id, text, ts],
    )?;
    Ok(())
}

pub fn message_exists(conn: &Connection, id: &str) -> AppResult<bool> {
    Ok(conn.query_row("SELECT 1 FROM messages WHERE id = ?1", [id], |_| Ok(())).optional()?.is_some())
}

/// Safely build an FTS5 MATCH query from user input:
/// splits on whitespace, skips tokens without any alphanumeric char, escapes quotes, and turns each
/// word into a quoted prefix term `"word"*` (implicit AND). Empty / whitespace input → `None`.
fn fts_query(text: &str) -> Option<String> {
    let terms: Vec<String> = text
        .split_whitespace()
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .take(16)
        .map(|w| {
            let escaped = w.replace('\0', "").replace('"', "\"\"");
            format!("\"{escaped}\"*")
        })
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Full-text search across user & assistant messages, excluding soft-deleted threads.
/// Ordered by FTS5 rank (`bm25`) then recency (`created_at DESC`), capped at 100 hits.
pub fn search_messages(conn: &Connection, query: &str, limit: u32) -> AppResult<Vec<MessageHit>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let Some(fts) = fts_query(query) else {
        return Ok(Vec::new());
    };
    let limit = i64::from(limit.min(100));
    let mut stmt = conn.prepare_cached(
        "SELECT t.id, t.title, t.project_id, t.agent, m.id, m.role,
                snippet(messages_fts, 0, char(2), char(3), '…', 24),
                m.created_at
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN threads t ON t.id = m.thread_id
         WHERE messages_fts MATCH ?1
           AND m.role IN ('user', 'assistant')
           AND t.deleted_at IS NULL
         ORDER BY bm25(messages_fts), m.created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![fts, limit], |r| {
        Ok(MessageHit {
            thread_id: r.get(0)?,
            thread_title: r.get(1)?,
            project_id: r.get(2)?,
            agent: r.get(3)?,
            message_id: r.get(4)?,
            role: r.get(5)?,
            snippet: r.get(6)?,
            ts: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use serde_json::json;

    #[tokio::test]
    async fn timeline_roundtrip_in_order() {
        let db = Db::open_in_memory().unwrap();
        db.call(|c| {
            c.execute(
                "INSERT INTO threads (id, agent, title, status, created_at, updated_at) VALUES ('t', 'claude_code', '', 'idle', 0, 0)",
                [],
            )?;
            insert_message(c, "u1", "t", "user", "fais un test", None, 1)?;
            insert_message(c, "m:0", "t", "thinking", "je réfléchis", None, 2)?;
            insert_tool_call(c, "tool1", "t", "Edit", &json!({"file_path": "src/app.tsx"}), 3)?;
            finish_tool_call(c, "tool1", "ok", ToolStatus::Ok, &[], 4)?;
            insert_message(c, "m:1", "t", "assistant", "fini", None, 5)?;
            let usage = TokenUsage { input: 10, output: 5, ..Default::default() };
            insert_message(c, "turn1", "t", "turn", "", Some(&json!({"usage": usage, "durationMs": 1200})), 6)?;
            insert_message(c, "m:1", "t", "assistant", "fini (maj)", None, 5)?; // upsert keeps position

            let items = history(c, "t")?;
            let kinds: Vec<&str> = items
                .iter()
                .map(|i| match i {
                    ChatItem::User { .. } => "user",
                    ChatItem::Thinking { .. } => "thinking",
                    ChatItem::Tool { .. } => "tool",
                    ChatItem::Text { .. } => "text",
                    ChatItem::Turn { .. } => "turn",
                    _ => "other",
                })
                .collect();
            assert_eq!(kinds, ["user", "thinking", "tool", "text", "turn"]);
            match &items[2] {
                ChatItem::Tool { status, activity, .. } => {
                    assert_eq!(*status, ToolStatus::Ok);
                    assert_eq!(activity.as_deref(), Some("app.tsx"));
                }
                _ => unreachable!(),
            }
            match &items[3] {
                ChatItem::Text { text, .. } => assert_eq!(text, "fini (maj)"),
                _ => unreachable!(),
            }
            match &items[4] {
                ChatItem::Turn { usage, duration_ms, .. } => {
                    assert_eq!(usage.input, 10);
                    assert_eq!(*duration_ms, Some(1200));
                }
                _ => unreachable!(),
            }

            record_prompt(c, None, "a", 1)?;
            record_prompt(c, None, "b", 2)?;
            record_prompt(c, None, "a", 3)?;
            assert_eq!(prompt_history(c, None, 10)?, ["a", "b"]);
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn search_messages_accents_safety_and_deleted_exclusion() {
        let db = Db::open_in_memory().unwrap();
        db.call(|c| {
            c.execute_batch(
                "INSERT INTO projects (id, name, path, created_at) VALUES ('p1', 'App', '/app', 1);
                 INSERT INTO threads (id, project_id, agent, title, status, created_at, updated_at) VALUES
                   ('t1', 'p1', 'claude_code', 'Release', 'done', 1, 10),
                   ('t2', NULL, 'codex', 'Deleted chat', 'done', 1, 20);",
            )?;
            insert_message(c, "m1", "t1", "user", "Prépare le déploiement en prod", None, 100)?;
            insert_message(c, "m2", "t1", "assistant", "Le déploiement et le redéploiement sont prêts.", None, 200)?;
            insert_message(c, "m3", "t1", "thinking", "réflexion interne déploiement", None, 250)?;
            insert_message(c, "m4", "t1", "error", "erreur déploiement", None, 260)?;
            insert_message(c, "m5", "t2", "user", "Autre déploiement sur un chat supprimé", None, 300)?;

            // Empty / whitespace / punctuation-only queries return empty vec without error.
            assert!(search_messages(c, "", 30)?.is_empty());
            assert!(search_messages(c, "   \t\n ", 30)?.is_empty());
            assert!(search_messages(c, "\"\"\" --- ???", 30)?.is_empty());
            assert!(search_messages(c, "deploiement", 0)?.is_empty());

            // Accent-insensitive + prefix + role filtering (excludes thinking & error).
            let hits = search_messages(c, "deploi", 30)?;
            assert_eq!(hits.len(), 3);
            assert!(hits.iter().all(|h| matches!(h.role.as_str(), "user" | "assistant")));
            assert!(hits.iter().all(|h| h.snippet.contains('\u{2}') && h.snippet.contains('\u{3}')));

            // Multi-word AND + quote escaping / FTS operator words never fail.
            let exact = search_messages(c, "\"deploiement\" prod", 30)?;
            assert_eq!(exact.len(), 1);
            assert_eq!(exact[0].message_id, "m1");
            assert_eq!(exact[0].thread_id, "t1");
            assert_eq!(exact[0].thread_title, "Release");
            assert_eq!(exact[0].project_id.as_deref(), Some("p1"));
            assert_eq!(exact[0].agent, AgentKind::ClaudeCode);
            assert_eq!(exact[0].ts, 100);
            assert!(search_messages(c, "NOT OR NEAR \"foo\" (bar)", 30)?.is_empty());

            // Soft-deleting t2 excludes its messages from search; restoring brings them back.
            crate::db::threads::soft_delete(c, "t2", 1_000)?;
            let hits = search_messages(c, "deploiement", 30)?;
            assert_eq!(hits.len(), 2);
            assert!(hits.iter().all(|h| h.thread_id == "t1"));

            crate::db::threads::restore(c, "t2")?;
            assert_eq!(search_messages(c, "deploiement", 30)?.len(), 3);

            // Purging t2 removes it permanently and keeps FTS index intact.
            crate::db::threads::soft_delete(c, "t2", 1_000)?;
            assert_eq!(crate::db::threads::purge_deleted(c, 1_000)?, 1);
            assert_eq!(search_messages(c, "deploiement", 30)?.len(), 2);
            c.execute("INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')", [])?;
            Ok(())
        })
        .await
        .unwrap();
    }
}
