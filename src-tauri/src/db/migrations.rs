//! Embedded, append-only SQL migrations tracked with `PRAGMA user_version`.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Ordered list of migrations. Index + 1 == schema version. Never reorder or edit released entries.
const MIGRATIONS: &[(&str, &str)] = &[("0001_init", include_str!("../../migrations/0001_init.sql"))];

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
        "tool_calls",
        "token_usage",
        "providers",
        "memories",
        "memories_fts",
        "agent_configs",
        "settings",
        "prompt_history",
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
            let found: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(found, 1, "missing table {table}");
        }
    }

    #[test]
    fn memories_fts_stays_in_sync() {
        let conn = fresh();
        let search = |q: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM memories_fts WHERE memories_fts MATCH ?1",
                [q],
                |r| r.get(0),
            )
            .unwrap()
        };

        conn.execute(
            "INSERT INTO memories (id, category, content, created_at, updated_at)
             VALUES ('m1', 'code_style', 'Toujours préférer Rust strict', 0, 0)",
            [],
        )
        .unwrap();
        assert_eq!(search("rust"), 1);
        assert_eq!(search("preferer"), 1, "diacritics should be folded");

        conn.execute("UPDATE memories SET content = 'TypeScript strict' WHERE id = 'm1'", [])
            .unwrap();
        assert_eq!(search("rust"), 0);
        assert_eq!(search("typescript"), 1);

        conn.execute("DELETE FROM memories WHERE id = 'm1'", []).unwrap();
        assert_eq!(search("typescript"), 0);
    }

    #[test]
    fn rejects_newer_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 1)
            .unwrap();
        assert!(apply(&mut conn).is_err());
    }
}
