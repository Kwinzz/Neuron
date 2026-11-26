//! Paired devices (see `crate::remote`). Pairing is directional: a *client* may control this device, a *host* is a
//! device this one controls. Both are identified by their iroh endpoint id (public key, hex).

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult};

/// What a paired client may do on this device. Ordered: each level includes the previous ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AccessLevel {
    /// Lists, chat history, home screen, quotas.
    Read,
    /// + write, stop, create chats, answer approvals, change modes (except « Tout autoriser »).
    Chat,
    /// Everything that can be done on site: « Tout autoriser », projects, memory edits.
    Full,
}

impl AccessLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            AccessLevel::Read => "read",
            AccessLevel::Chat => "chat",
            AccessLevel::Full => "full",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "read" => AccessLevel::Read,
            "chat" => AccessLevel::Chat,
            _ => AccessLevel::Full,
        }
    }
}

/// A device allowed to control this one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteClient {
    pub node_id: String,
    pub name: String,
    pub level: AccessLevel,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub last_seen: Option<i64>,
    /// Connected right now (filled by the command layer).
    pub connected: bool,
}

/// A device this one controls.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteHost {
    pub node_id: String,
    pub name: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub last_seen: Option<i64>,
    /// Connected right now (filled by the command layer).
    pub connected: bool,
    /// Path of the live connection (filled by the command layer): through a relay, round-trip time.
    pub path: Option<crate::remote::node::HostPath>,
}

fn client_row(r: &Row<'_>) -> rusqlite::Result<RemoteClient> {
    Ok(RemoteClient {
        node_id: r.get(0)?,
        name: r.get(1)?,
        level: AccessLevel::parse(&r.get::<_, String>(2)?),
        created_at: r.get(3)?,
        last_seen: r.get(4)?,
        connected: false,
    })
}

fn host_row(r: &Row<'_>) -> rusqlite::Result<RemoteHost> {
    Ok(RemoteHost {
        node_id: r.get(0)?,
        name: r.get(1)?,
        created_at: r.get(2)?,
        last_seen: r.get(3)?,
        connected: false,
        path: None,
    })
}

/// Pairing a device again keeps its level (a re-pairing never silently widens nor narrows access).
pub fn upsert_client(conn: &Connection, node_id: &str, name: &str, level: AccessLevel, now: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO remote_clients (node_id, name, level, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(node_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen",
        params![node_id, name, level.as_str(), now],
    )?;
    Ok(())
}

pub fn list_clients(conn: &Connection) -> AppResult<Vec<RemoteClient>> {
    let mut stmt = conn
        .prepare_cached("SELECT node_id, name, level, created_at, last_seen FROM remote_clients ORDER BY created_at")?;
    let rows = stmt.query_map([], client_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Level granted to a client, `None` when it is not (or no longer) paired.
pub fn client_level(conn: &Connection, node_id: &str) -> AppResult<Option<AccessLevel>> {
    let level: Option<String> =
        conn.query_row("SELECT level FROM remote_clients WHERE node_id = ?1", [node_id], |r| r.get(0)).optional()?;
    Ok(level.map(|l| AccessLevel::parse(&l)))
}

pub fn set_client_level(conn: &Connection, node_id: &str, level: AccessLevel) -> AppResult<()> {
    let changed =
        conn.execute("UPDATE remote_clients SET level = ?2 WHERE node_id = ?1", params![node_id, level.as_str()])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("device {node_id}")));
    }
    Ok(())
}

pub fn delete_client(conn: &Connection, node_id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM remote_clients WHERE node_id = ?1", [node_id])?;
    Ok(())
}

pub fn touch_client(conn: &Connection, node_id: &str, now: i64) -> AppResult<()> {
    conn.execute("UPDATE remote_clients SET last_seen = ?2 WHERE node_id = ?1", params![node_id, now])?;
    Ok(())
}

pub fn upsert_host(conn: &Connection, node_id: &str, name: &str, now: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO remote_hosts (node_id, name, created_at, last_seen) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(node_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen",
        params![node_id, name, now],
    )?;
    Ok(())
}

pub fn list_hosts(conn: &Connection) -> AppResult<Vec<RemoteHost>> {
    let mut stmt =
        conn.prepare_cached("SELECT node_id, name, created_at, last_seen FROM remote_hosts ORDER BY created_at")?;
    let rows = stmt.query_map([], host_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn delete_host(conn: &Connection, node_id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM remote_hosts WHERE node_id = ?1", [node_id])?;
    Ok(())
}

pub fn touch_host(conn: &Connection, node_id: &str, now: i64) -> AppResult<()> {
    conn.execute("UPDATE remote_hosts SET last_seen = ?2 WHERE node_id = ?1", params![node_id, now])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[tokio::test]
    async fn clients_and_hosts() {
        let db = Db::open_in_memory().unwrap();
        db.call(|c| {
            assert_eq!(client_level(c, "a")?, None);
            upsert_client(c, "a", "Portable", AccessLevel::Full, 1)?;
            assert_eq!(client_level(c, "a")?, Some(AccessLevel::Full));
            set_client_level(c, "a", AccessLevel::Read)?;
            // Pairing again renames but keeps the level chosen by the user.
            upsert_client(c, "a", "Portable Arch", AccessLevel::Full, 2)?;
            let clients = list_clients(c)?;
            assert_eq!((clients[0].name.as_str(), clients[0].level), ("Portable Arch", AccessLevel::Read));
            assert!(set_client_level(c, "zzz", AccessLevel::Chat).is_err());
            delete_client(c, "a")?;
            assert_eq!(client_level(c, "a")?, None);

            upsert_host(c, "b", "PC", 3)?;
            touch_host(c, "b", 9)?;
            assert_eq!(list_hosts(c)?[0].last_seen, Some(9));
            delete_host(c, "b")?;
            assert!(list_hosts(c)?.is_empty());
            assert!(AccessLevel::Read < AccessLevel::Chat && AccessLevel::Chat < AccessLevel::Full);
            Ok(())
        })
        .await
        .unwrap();
    }
}
