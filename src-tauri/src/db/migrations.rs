//! Embedded, append-only SQL migrations tracked with `PRAGMA user_version`.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Ordered list of migrations. Index + 1 == schema version. Never reorder or edit released entries.
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("../../migrations/0001_init.sql")),
    ("0002_default_providers", include_str!("../../migrations/0002_default_providers.sql")),
    ("0003_thread_runtime", include_str!("../../migrations/0003_thread_runtime.sql")),
    ("0004_thread_effort", include_str!("../../migrations/0004_thread_effort.sql")),
    ("0005_thread_context", include_str!("../../migrations/0005_thread_context.sql")),
    ("0006_tool_changes", include_str!("../../migrations/0006_tool_changes.sql")),
    ("0007_cli_usage_logs", include_str!("../../migrations/0007_cli_usage_logs.sql")),
    ("0008_claude_turn_costs", include_str!("../../migrations/0008_claude_turn_costs.sql")),
    ("0009_remote_devices", include_str!("../../migrations/0009_remote_devices.sql")),
    ("0010_thread_organization", include_str!("../../migrations/0010_thread_organization.sql")),
    ("0011_remote_workspace", include_str!("../../migrations/0011_remote_workspace.sql")),
];

/// Schema version after all embedded migrations are applied.
pub const LATEST_VERSION: u32 = MIGRATIONS.len() as u32;

pub fn current_version(conn: &Connection) -> AppResult<u32> {
    Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

/// Apply every pending migration, each in its own transaction. Returns the resulting version.
pub fn apply(conn: &mut Connection) -> AppResult<u32> {
    let current = current_version(conn)?;
    if current > LATEST_VERSION {
        return Err(AppError::Other(format!(
            "database schema v{current} is newer than this build (v{LATEST_VERSION})"
        )));
    }

    for (index, (name, sql)) in MIGRATIONS.iter().enumerate() {
        let version = index as u32 + 1;
        if version <= current {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
        tracing::info!(version, name, "applied migration");
    }

    current_version(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED_TABLES: &[&str] = &[
        "projects",
        "threads",
        "messages",
        "messages_fts",
        "tool_calls",
        "token_usage",
        "providers",
        "memories",
        "memories_fts",
        "agent_configs",
        "settings",
        "prompt_history",
        "remote_clients",
        "remote_hosts",
        "workspace_grants",
    ];

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk");
        apply(&mut conn).expect("migrate");
        conn
    }

    #[test]
    fn applies_all_migrations_and_is_idempotent() {
        let mut conn = fresh();
        assert_eq!(current_version(&conn).unwrap(), LATEST_VERSION);
        assert_eq!(apply(&mut conn).unwrap(), LATEST_VERSION);
    }

    #[test]
    fn creates_every_table() {
        let conn = fresh();
        for table in EXPECTED_TABLES {
            let found: i64 =
                conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = ?1", [table], |r| r.get(0)).unwrap();
            assert_eq!(found, 1, "missing table {table}");
        }
    }

    #[test]
    fn memories_fts_stays_in_sync() {
        let conn = fresh();
        let search = |q: &str| -> i64 {
            conn.query_row("SELECT COUNT(*) FROM memories_fts WHERE memories_fts MATCH ?1", [q], |r| r.get(0)).unwrap()
        };

        conn.execute(
            "INSERT INTO memories (id, category, content, created_at, updated_at)
             VALUES ('m1', 'code_style', 'Toujours préférer Rust strict', 0, 0)",
            [],
        )
        .unwrap();
        assert_eq!(search("rust"), 1);
        assert_eq!(search("preferer"), 1, "diacritics should be folded");

        conn.execute("UPDATE memories SET content = 'TypeScript strict' WHERE id = 'm1'", []).unwrap();
        assert_eq!(search("rust"), 0);
        assert_eq!(search("typescript"), 1);

        conn.execute("DELETE FROM memories WHERE id = 'm1'", []).unwrap();
        assert_eq!(search("typescript"), 0);
    }

    #[test]
    fn claude_turn_costs_become_per_turn() {
        // Schema v7, with costs stored as Claude's running totals.
        let mut conn = Connection::open_in_memory().unwrap();
        for (_, sql) in &MIGRATIONS[..7] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 7).unwrap();
        conn.execute_batch(
            r#"INSERT INTO threads (id, agent, title, status, created_at, updated_at)
                 VALUES ('c', 'claude_code', '', 'done', 0, 0), ('x', 'codex', '', 'done', 0, 0);
               INSERT INTO token_usage (thread_id, agent, cost_usd, ts) VALUES
                 ('c', 'claude_code', 1.0, 1), ('c', 'claude_code', 1.5, 2), ('c', 'claude_code', 0.25, 3),
                 ('c', 'claude_code', 0.75, 4), ('x', 'codex', 1.0, 1), ('x', 'codex', 2.0, 2);
               INSERT INTO messages (id, thread_id, seq, role, meta_json, created_at) VALUES
                 ('t1', 'c', 1, 'turn', '{"usage":{"costUsd":1.0},"durationMs":5}', 1),
                 ('t2', 'c', 2, 'turn', '{"usage":{"costUsd":1.5},"durationMs":5}', 2),
                 ('u3', 'c', 3, 'user', NULL, 3),
                 ('t4', 'c', 4, 'turn', '{"usage":{"costUsd":0.25},"durationMs":5}', 4);"#,
        )
        .unwrap();
        apply(&mut conn).unwrap();

        let costs = |sql: &str| -> Vec<f64> {
            let mut stmt = conn.prepare(sql).unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
        };
        // 0.25 < 1.5: a new process, kept; then its own running total again.
        assert_eq!(costs("SELECT cost_usd FROM token_usage WHERE thread_id = 'c' ORDER BY ts"), [1.0, 0.5, 0.25, 0.5]);
        assert_eq!(costs("SELECT cost_usd FROM token_usage WHERE thread_id = 'x' ORDER BY ts"), [1.0, 2.0]);
        assert_eq!(
            costs("SELECT json_extract(meta_json, '$.usage.costUsd') FROM messages WHERE role = 'turn' ORDER BY seq"),
            [1.0, 0.5, 0.25]
        );
        let duration: i64 = conn
            .query_row("SELECT json_extract(meta_json, '$.durationMs') FROM messages WHERE id = 't2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(duration, 5);
    }

    #[test]
    fn messages_fts_stays_in_sync() {
        let conn = fresh();
        let search = |q: &str| -> i64 {
            conn.query_row("SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH ?1", [q], |r| r.get(0)).unwrap()
        };

        conn.execute(
            "INSERT INTO threads (id, agent, title, status, created_at, updated_at) VALUES ('t1', 'claude_code', 'Test', 'idle', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, thread_id, seq, role, content, created_at)
             VALUES ('m1', 't1', 1, 'user', 'Préparer le déploiement', 1)",
            [],
        )
        .unwrap();
        assert_eq!(search("deploiement"), 1, "diacritics should be folded");

        conn.execute("UPDATE messages SET content = 'Migration terminée' WHERE id = 'm1'", []).unwrap();
        assert_eq!(search("deploiement"), 0);
        assert_eq!(search("terminee"), 1);

        // Cascade delete from threads must keep messages_fts in sync.
        conn.execute("DELETE FROM threads WHERE id = 't1'", []).unwrap();
        assert_eq!(search("terminee"), 0);
        conn.execute("INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')", []).unwrap();
    }

    #[test]
    fn migrates_v9_to_v10_and_rebuilds_messages_fts() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        for (_, sql) in &MIGRATIONS[..9] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 9).unwrap();
        conn.execute_batch(
            "INSERT INTO threads (id, agent, title, status, created_at, updated_at)
               VALUES ('t1', 'claude_code', 'Infra', 'done', 10, 20);
             INSERT INTO messages (id, thread_id, seq, role, content, created_at) VALUES
               ('m1', 't1', 1, 'user', 'Lancer le déploiement en préproduction', 11),
               ('m2', 't1', 2, 'assistant', 'Déploiement réussi sans erreur.', 12),
               ('m3', 't1', 3, 'thinking', 'vérification déploiement', 13);",
        )
        .unwrap();

        assert_eq!(apply(&mut conn).unwrap(), LATEST_VERSION);
        assert_eq!(LATEST_VERSION, 11);

        let flags: (Option<i64>, Option<i64>, Option<i64>) = conn
            .query_row("SELECT pinned_at, archived_at, deleted_at FROM threads WHERE id = 't1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(flags, (None, None, None));

        let hits = crate::db::chat::search_messages(&conn, "deploiement", 30).unwrap();
        assert_eq!(hits.len(), 2, "only user + assistant messages are returned");
        assert!(hits.iter().all(|h| h.snippet.contains('\u{2}') && h.snippet.contains('\u{3}')));
        conn.execute("INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')", []).unwrap();
    }

    #[test]
    fn rejects_newer_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 1).unwrap();
        assert!(apply(&mut conn).is_err());
    }
}
