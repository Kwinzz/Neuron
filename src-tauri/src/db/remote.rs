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

/// Which folders remote workspace tools may touch on this device.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum WorkspaceScope {
    /// Restricted to registered Neuron projects (host mode) or the grant's `root_cwd` (grant mode).
    #[default]
    ProjectOnly,
    /// Any folder accessible to the local user.
    Full,
}

impl WorkspaceScope {
    pub fn as_str(self) -> &'static str {
        match self {
            WorkspaceScope::ProjectOnly => "project_only",
            WorkspaceScope::Full => "full",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "full" => WorkspaceScope::Full,
            _ => WorkspaceScope::ProjectOnly,
        }
    }
}

/// Explicit authorization issued by this device letting a paired AI host run workspace tools in `root_cwd`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorkspaceGrant {
    pub id: String,
    pub peer_node_id: String,
    pub peer_name: String,
    pub thread_id: Option<String>,
    pub root_cwd: String,
    pub scope: WorkspaceScope,
    #[ts(type = "number")]
    pub created_at: i64,
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

fn grant_row(r: &Row<'_>) -> rusqlite::Result<WorkspaceGrant> {
    Ok(WorkspaceGrant {
        id: r.get(0)?,
        peer_node_id: r.get(1)?,
        peer_name: r.get(2)?,
        thread_id: r.get(3)?,
        root_cwd: r.get(4)?,
        scope: WorkspaceScope::parse(&r.get::<_, String>(5)?),
        created_at: r.get(6)?,
    })
}

pub fn create_grant(
    conn: &Connection,
    id: &str,
    peer_node_id: &str,
    peer_name: &str,
    root_cwd: &str,
    scope: WorkspaceScope,
    now: i64,
) -> AppResult<WorkspaceGrant> {
    conn.execute(
        "INSERT INTO workspace_grants (id, peer_node_id, peer_name, root_cwd, scope, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, peer_node_id, peer_name, root_cwd, scope.as_str(), now],
    )?;
    Ok(WorkspaceGrant {
        id: id.to_string(),
        peer_node_id: peer_node_id.to_string(),
        peer_name: peer_name.to_string(),
        thread_id: None,
        root_cwd: root_cwd.to_string(),
        scope,
        created_at: now,
    })
}

pub fn bind_grant_thread(conn: &Connection, grant_id: &str, thread_id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE workspace_grants SET thread_id = ?2 WHERE id = ?1 AND revoked_at IS NULL",
        params![grant_id, thread_id],
    )?;
    Ok(())
}

pub fn get_active_grant(conn: &Connection, id: &str, peer_node_id: &str) -> AppResult<Option<WorkspaceGrant>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, peer_node_id, peer_name, thread_id, root_cwd, scope, created_at
         FROM workspace_grants WHERE id = ?1 AND peer_node_id = ?2 AND revoked_at IS NULL",
    )?;
    Ok(stmt.query_row(params![id, peer_node_id], grant_row).optional()?)
}

pub fn list_active_grants(conn: &Connection) -> AppResult<Vec<WorkspaceGrant>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, peer_node_id, peer_name, thread_id, root_cwd, scope, created_at
         FROM workspace_grants WHERE revoked_at IS NULL ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], grant_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn revoke_grant(conn: &Connection, id: &str, now: i64) -> AppResult<()> {
    conn.execute("UPDATE workspace_grants SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL", params![id, now])?;
    Ok(())
}

pub fn revoke_grants_for_peer(conn: &Connection, peer_node_id: &str, now: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE workspace_grants SET revoked_at = ?2 WHERE peer_node_id = ?1 AND revoked_at IS NULL",
        params![peer_node_id, now],
    )?;
    Ok(())
}

pub fn revoke_grants_for_thread(conn: &Connection, thread_id: &str, now: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE workspace_grants SET revoked_at = ?2 WHERE thread_id = ?1 AND revoked_at IS NULL",
        params![thread_id, now],
    )?;
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

            // Workspace grants lifecycle.
            let g = create_grant(c, "g1", "peer-b", "PC-Fixe", "/proj", WorkspaceScope::ProjectOnly, 10)?;
            assert_eq!(g.scope, WorkspaceScope::ProjectOnly);
            bind_grant_thread(c, "g1", "th-1")?;
            assert_eq!(get_active_grant(c, "g1", "peer-b")?.unwrap().thread_id.as_deref(), Some("th-1"));
            assert!(get_active_grant(c, "g1", "other-peer")?.is_none());
            assert_eq!(list_active_grants(c)?.len(), 1);
            revoke_grant(c, "g1", 20)?;
            assert!(get_active_grant(c, "g1", "peer-b")?.is_none());
            assert!(list_active_grants(c)?.is_empty());
            Ok(())
        })
        .await
        .unwrap();
    }
}
