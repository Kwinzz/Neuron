//! Control the chats of other devices running Neuron, without any central server.
//!
//! Each instance has an iroh endpoint identified by a public key (`<data_dir>/remote.key`). Devices find each
//! other on the local network (mDNS), pair once with a 6-digit code ([`pairing`]), then a paired *client* sends the
//! host the same commands as the local frontend ([`dispatch`], checked against its [`AccessLevel`]) and receives
//! the host's events ([`hub`]). Local network only for now: no relay, no DNS, no traffic leaves the LAN.
//!
//! Nothing runs until it is needed: the endpoint starts when access from other devices is enabled, when this
//! device controls a paired host, or when the user looks for nearby devices.

pub mod dispatch;
pub mod hub;
pub mod mdns;
pub mod node;
pub mod pairing;
pub mod protocol;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use iroh::SecretKey;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::db::remote::{self as store, AccessLevel};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util::now_ms;
use node::{Backend, BoxFut, Node, NodeConfig};
use protocol::{RpcRequest, WireEvent};

/// Host events, re-emitted to this device's frontend.
pub const REMOTE_EVENT_CHANNEL: &str = "remote://event";
/// Paired devices, connections, nearby devices or pairing window changed.
pub const REMOTE_STATUS_CHANNEL: &str = "remote://status";
const SETTINGS_KEY: &str = "remote.settings";
const KEY_FILE: &str = "remote.key";

/// Settings of the feature (own key in `settings`, changed only through the `remote_*` commands).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct RemoteSettings {
    /// Other devices may pair with and control this one.
    pub enabled: bool,
    /// Name shown to the other devices.
    pub device_name: String,
}

impl Default for RemoteSettings {
    fn default() -> Self {
        Self { enabled: false, device_name: default_device_name() }
    }
}

/// The machine's name (`COMPUTERNAME`, `/etc/hostname`…), else « Neuron ».
pub fn default_device_name() -> String {
    let from_env = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).ok();
    let from_file = || std::fs::read_to_string("/etc/hostname").ok();
    from_env
        .or_else(from_file)
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Neuron".into())
}

pub fn load_settings(conn: &Connection) -> AppResult<RemoteSettings> {
    Ok(crate::db::settings::get(conn, SETTINGS_KEY)?.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default())
}

pub fn save_settings(conn: &Connection, settings: &RemoteSettings) -> AppResult<()> {
    crate::db::settings::set(conn, SETTINGS_KEY, &serde_json::to_value(settings)?)
}

/// This device's identity, created on first use. Whoever has this file can pass for this device: it stays in the
/// app's data folder, readable by the user only on Unix.
fn load_or_create_secret(data_dir: &Path) -> AppResult<SecretKey> {
    let path = data_dir.join(KEY_FILE);
    if let Ok(bytes) = std::fs::read(&path) {
        if let Ok(bytes) = <[u8; 32]>::try_from(bytes.as_slice()) {
            return Ok(SecretKey::from_bytes(&bytes));
        }
        tracing::warn!("remote: unreadable key file, a new identity is created");
    }
    let secret = SecretKey::generate();
    std::fs::write(&path, secret.to_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(secret)
}

/// Payload of [`REMOTE_EVENT_CHANNEL`]: an event of a paired host.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteEventPayload {
    /// Host's node id.
    pub device: String,
    /// Original channel (`agent://event`…).
    pub channel: String,
    #[ts(type = "unknown")]
    pub payload: Value,
}

/// The feature's state, kept in [`AppState`].
pub struct Remote {
    data_dir: PathBuf,
    node: tokio::sync::Mutex<Option<Arc<Node>>>,
    /// The user looked for nearby devices: keep the endpoint running for this session.
    scanning: AtomicBool,
}

impl Remote {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir, node: tokio::sync::Mutex::new(None), scanning: AtomicBool::new(false) }
    }

    /// The running node, if any.
    pub async fn node(&self) -> Option<Arc<Node>> {
        self.node.lock().await.clone()
    }

    /// Starts, restarts or stops the endpoint to match the settings and paired devices.
    pub async fn sync(&self, app: &AppHandle) -> AppResult<Option<Arc<Node>>> {
        let state = app.state::<AppState>();
        let (settings, hosts) = state.db.call(|c| Ok((load_settings(c)?, store::list_hosts(c)?.len()))).await?;
        let needed = settings.enabled || hosts > 0 || self.scanning.load(Ordering::Relaxed);
        let mut slot = self.node.lock().await;
        if let Some(node) = slot.as_ref() {
            if needed && node.is_hosting() == settings.enabled && node.name() == node::clean_name(&settings.device_name)
            {
                return Ok(Some(Arc::clone(node)));
            }
        }
        if let Some(old) = slot.take() {
            old.shutdown().await;
        }
        if needed {
            let secret = load_or_create_secret(&self.data_dir)?;
            let config = NodeConfig {
                secret,
                name: settings.device_name.clone(),
                hosting: settings.enabled,
                mdns: true,
                fixed_port: settings.enabled,
            };
            let backend = Arc::new(AppBackend { app: app.clone() });
            let node = Node::start(config, backend, hub::sender()).await?;
            tracing::info!(
                id = %node.id().fmt_short(),
                hosting = settings.enabled,
                port = ?node.port(),
                "remote: endpoint started"
            );
            *slot = Some(node);
        }
        let _ = app.emit_to("main", REMOTE_STATUS_CHANNEL, ());
        Ok(slot.clone())
    }

    /// The node, started if needed (looking for devices, pairing, calling a host).
    pub async fn ensure(&self, app: &AppHandle) -> AppResult<Arc<Node>> {
        self.scanning.store(true, Ordering::Relaxed);
        self.sync(app).await?.ok_or_else(|| AppError::Other("remote endpoint not started".into()))
    }

    pub async fn shutdown(&self) {
        if let Some(node) = self.node.lock().await.take() {
            node.shutdown().await;
        }
    }
}

/// Starts the endpoint in the background when the feature is in use (never blocks the startup).
pub fn spawn_start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else { return };
        if let Err(err) = state.remote.sync(&app).await {
            tracing::warn!(%err, "remote: endpoint not started");
        }
    });
}

/// [`Backend`] of the app: SQLite for the paired devices, the commands for the requests, Tauri events for the UI.
struct AppBackend {
    app: AppHandle,
}

impl AppBackend {
    fn db(&self) -> crate::db::Db {
        self.app.state::<AppState>().db.clone()
    }
}

impl Backend for AppBackend {
    fn client_level(&self, client: String) -> BoxFut<Option<AccessLevel>> {
        let db = self.db();
        Box::pin(async move { db.call(move |c| store::client_level(c, &client)).await.ok().flatten() })
    }

    fn call(&self, client: String, level: AccessLevel, request: RpcRequest) -> BoxFut<AppResult<Value>> {
        let app = self.app.clone();
        Box::pin(async move {
            tracing::info!(client = %client.get(..10).unwrap_or(&client), method = %request.method, "remote call");
            dispatch::call(&app, level, &request.method, request.args).await
        })
    }

    fn client_paired(&self, client: String, name: String) -> BoxFut<AppResult<()>> {
        let db = self.db();
        Box::pin(
            async move { db.call(move |c| store::upsert_client(c, &client, &name, AccessLevel::Full, now_ms())).await },
        )
    }

    fn host_paired(&self, host: String, name: String) -> BoxFut<AppResult<()>> {
        let db = self.db();
        Box::pin(async move { db.call(move |c| store::upsert_host(c, &host, &name, now_ms())).await })
    }

    fn client_seen(&self, client: String) {
        let db = self.db();
        tauri::async_runtime::spawn(async move {
            let _ = db.call(move |c| store::touch_client(c, &client, now_ms())).await;
        });
    }

    fn host_seen(&self, host: String) {
        let db = self.db();
        tauri::async_runtime::spawn(async move {
            let _ = db.call(move |c| store::touch_host(c, &host, now_ms())).await;
        });
    }

    fn host_event(&self, host: String, event: WireEvent) {
        let payload = RemoteEventPayload { device: host, channel: event.channel, payload: event.payload };
        if let Err(err) = self.app.emit_to("main", REMOTE_EVENT_CHANNEL, payload) {
            tracing::warn!(%err, "remote: host event not emitted");
        }
    }

    /// A paired host showed up on the network: connect, so its chats and events appear right away.
    fn discovered(&self, id: String) {
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let Some(state) = app.try_state::<AppState>() else { return };
            let probe = id.clone();
            let paired = state.db.call(move |c| Ok(store::list_hosts(c)?.iter().any(|h| h.node_id == probe))).await;
            if !paired.unwrap_or(false) {
                return;
            }
            if let Some(node) = state.remote.node().await {
                if let Err(err) = node.connect_host(&id).await {
                    tracing::debug!(%err, "remote: paired host not reachable yet");
                }
            }
        });
    }

    fn changed(&self) {
        let _ = self.app.emit_to("main", REMOTE_STATUS_CHANNEL, ());
    }
}
