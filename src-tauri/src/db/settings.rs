//! Key/value settings (values are JSON).

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::error::AppResult;

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<Value>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set(conn: &Connection, key: &str, value: &Value) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}

/// Latest Claude subscription windows reported by `rate_limit_event`.
pub const CLAUDE_RATE_LIMITS: &str = "claude.rate_limits";
/// Last working directory used to create a thread.
pub const LAST_CWD: &str = "threads.last_cwd";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use serde_json::json;

    #[tokio::test]
    async fn roundtrip() {
        let db = Db::open_in_memory().unwrap();
        db.call(|c| {
            assert!(get(c, "x")?.is_none());
            set(c, "x", &json!({"a": 1}))?;
            set(c, "x", &json!({"a": 2}))?;
            assert_eq!(get(c, "x")?, Some(json!({"a": 2})));
            Ok(())
        })
        .await
        .unwrap();
    }
}
