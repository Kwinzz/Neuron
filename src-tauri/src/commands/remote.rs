//! Remote devices: settings, pairing, paired devices and calls to a paired host (see `crate::remote`).

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::State;
use ts_rs::TS;

use crate::attachments::{self, Attachment, SharedFile};
use crate::db::remote::{self as store, AccessLevel, RemoteClient, RemoteHost};
use crate::error::{AppError, AppResult};
use crate::remote::node::NearbyDevice;
use crate::remote::pairing::PairingCode;
use crate::remote::protocol::RpcRequest;
use crate::remote::{self, RemoteSettings};
use crate::state::{AppState, Shared};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteStatus {
    pub settings: RemoteSettings,
    /// This device's id (public key), once the endpoint has started.
    pub node_id: Option<String>,
    /// The endpoint is running (hosting and/or controlling devices).
    pub running: bool,
    /// UDP port the endpoint is listening on (useful for firewall rules when hosting).
    pub port: Option<u16>,
    /// Open pairing code (host side).
    pub pairing: Option<PairingCode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteDevices {
    /// Devices allowed to control this one.
    pub clients: Vec<RemoteClient>,
    /// Devices this one controls.
    pub hosts: Vec<RemoteHost>,
}

async fn status(state: &AppState) -> AppResult<RemoteStatus> {
    let settings = state.db.call(|c| remote::load_settings(c)).await?;
    let node = state.remote.node().await;
    Ok(RemoteStatus {
        settings,
        node_id: node.as_ref().map(|n| n.id().to_string()),
        running: node.is_some(),
        port: node.as_ref().and_then(|n| n.port()),
        pairing: node.as_ref().and_then(|n| n.pairing()),
    })
}

pub async fn remote_status_inner(state: &Shared) -> AppResult<RemoteStatus> {
    status(state).await
}

#[tauri::command]
pub async fn remote_status(state: State<'_, Shared>) -> AppResult<RemoteStatus> {
    remote_status_inner(&state).await
}

pub async fn remote_set_enabled_inner(state: &Shared, enabled: bool) -> AppResult<RemoteStatus> {
    state
        .db
        .call(move |c| {
            let mut settings = remote::load_settings(c)?;
            settings.enabled = enabled;
            remote::save_settings(c, &settings)
        })
        .await?;
    state.remote.sync(state).await?;
    status(state).await
}

/// Allow (or stop allowing) other devices to pair with and control this one.
#[tauri::command]
pub async fn remote_set_enabled(state: State<'_, Shared>, enabled: bool) -> AppResult<RemoteStatus> {
    remote_set_enabled_inner(&state, enabled).await
}

pub async fn remote_set_internet_inner(state: &Shared, enabled: bool) -> AppResult<RemoteStatus> {
    state
        .db
        .call(move |c| {
            let mut settings = remote::load_settings(c)?;
            settings.internet = enabled;
            remote::save_settings(c, &settings)
        })
        .await?;
    state.remote.sync(state).await?;
    status(state).await
}

/// Reach (and be reached by) paired devices outside the local network, through public relays. Pairing itself
/// stays local-only.
#[tauri::command]
pub async fn remote_set_internet(state: State<'_, Shared>, enabled: bool) -> AppResult<RemoteStatus> {
    remote_set_internet_inner(&state, enabled).await
}

pub async fn remote_set_device_name_inner(state: &Shared, name: String) -> AppResult<RemoteStatus> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid(crate::tr!("le nom est requis", "the name is required")));
    }
    state
        .db
        .call(move |c| {
            let mut settings = remote::load_settings(c)?;
            settings.device_name = name;
            remote::save_settings(c, &settings)
        })
        .await?;
    state.remote.sync(state).await?;
    status(state).await
}

#[tauri::command]
pub async fn remote_set_device_name(state: State<'_, Shared>, name: String) -> AppResult<RemoteStatus> {
    remote_set_device_name_inner(&state, name).await
}

pub async fn remote_start_pairing_inner(state: &Shared) -> AppResult<PairingCode> {
    state.remote.ensure(state).await?.open_pairing()
}

/// Opens a pairing window on this device: the code to type on the other one (2 minutes, 3 attempts).
#[tauri::command]
pub async fn remote_start_pairing(state: State<'_, Shared>) -> AppResult<PairingCode> {
    remote_start_pairing_inner(&state).await
}

pub async fn remote_cancel_pairing_inner(state: &Shared) -> AppResult<()> {
    if let Some(node) = state.remote.node().await {
        node.cancel_pairing();
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_cancel_pairing(state: State<'_, Shared>) -> AppResult<()> {
    remote_cancel_pairing_inner(&state).await
}

/// Neuron instances that accept connections on the local network (starts listening if needed).
#[tauri::command]
pub async fn remote_nearby(state: State<'_, Shared>) -> AppResult<Vec<NearbyDevice>> {
    Ok(state.remote.ensure(&state).await?.nearby())
}

/// Pairs with a nearby device showing `code`; this device can then control it. Returns its name.
#[tauri::command]
pub async fn remote_pair(state: State<'_, Shared>, node_id: String, code: String) -> AppResult<String> {
    let node = state.remote.ensure(&state).await?;
    let name = node.pair(&node_id, &code).await?;
    // Connect right away: its chats and events show up without waiting.
    if let Err(err) = node.connect_host(&node_id).await {
        tracing::debug!(%err, "remote: first connection after pairing failed");
    }
    Ok(name)
}

pub async fn remote_devices_inner(state: &Shared) -> AppResult<RemoteDevices> {
    let (mut clients, mut hosts) = state.db.call(|c| Ok((store::list_clients(c)?, store::list_hosts(c)?))).await?;
    if let Some(node) = state.remote.node().await {
        let (live_clients, live_hosts) = (node.connected_clients(), node.connected_hosts());
        for c in &mut clients {
            c.connected = live_clients.contains(&c.node_id);
        }
        for h in &mut hosts {
            h.connected = live_hosts.contains(&h.node_id);
            h.path = node.host_path(&h.node_id);
        }
    }
    Ok(RemoteDevices { clients, hosts })
}

#[tauri::command]
pub async fn remote_devices(state: State<'_, Shared>) -> AppResult<RemoteDevices> {
    remote_devices_inner(&state).await
}

pub async fn remote_set_level_inner(state: &Shared, node_id: String, level: AccessLevel) -> AppResult<()> {
    state.db.call(move |c| store::set_client_level(c, &node_id, level)).await
}

/// What a paired client may do on this device (applies to its next request).
#[tauri::command]
pub async fn remote_set_level(state: State<'_, Shared>, node_id: String, level: AccessLevel) -> AppResult<()> {
    remote_set_level_inner(&state, node_id, level).await
}

pub async fn remote_revoke_inner(state: &Shared, node_id: String) -> AppResult<()> {
    let id = node_id.clone();
    state.db.call(move |c| store::delete_client(c, &id)).await?;
    if let Some(node) = state.remote.node().await {
        node.drop_client(&node_id);
    }
    Ok(())
}

/// A paired client loses access right away (its connections are closed).
#[tauri::command]
pub async fn remote_revoke(state: State<'_, Shared>, node_id: String) -> AppResult<()> {
    remote_revoke_inner(&state, node_id).await
}

pub async fn remote_forget_inner(state: &Shared, node_id: String) -> AppResult<()> {
    let id = node_id.clone();
    state.db.call(move |c| store::delete_host(c, &id)).await?;
    if let Some(node) = state.remote.node().await {
        node.drop_host(&node_id);
    }
    state.remote.sync(state).await?;
    Ok(())
}

/// This device stops controlling a host.
#[tauri::command]
pub async fn remote_forget(state: State<'_, Shared>, node_id: String) -> AppResult<()> {
    remote_forget_inner(&state, node_id).await
}

/// The node, for a device this one controls (never dials an id that was not paired).
async fn host_node(state: &Shared, device: &str) -> AppResult<std::sync::Arc<remote::node::Node>> {
    let probe = device.to_string();
    let paired = state.db.call(move |c| Ok(store::list_hosts(c)?.iter().any(|h| h.node_id == probe))).await?;
    if !paired {
        return Err(AppError::NotFound(crate::tr!("appareil non appairé", "device not paired")));
    }
    state.remote.ensure(state).await
}

/// A command run on a paired host (same name and arguments as the local `invoke`); its result as JSON.
#[tauri::command]
pub async fn remote_call(
    state: State<'_, Shared>,
    device: String,
    method: String,
    args: Option<Value>,
) -> AppResult<Value> {
    let node = host_node(&state, &device).await?;
    node.call(&device, RpcRequest { method, args: args.unwrap_or(Value::Null) }).await
}

/// Files attached on this device to a message for a chat of a paired host: copied there (like a pasted file);
/// returns the host's copies, to send with the message.
#[tauri::command]
pub async fn remote_upload_attachments(
    state: State<'_, Shared>,
    device: String,
    attachments: Vec<Attachment>,
) -> AppResult<Vec<Attachment>> {
    let node = host_node(&state, &device).await?;
    let root = attachments::root(&state.paths.data_dir);
    let mut uploaded = Vec::new();
    for a in attachments::validate(&root, &attachments)? {
        if a.size > attachments::MAX_SHARED {
            let max = attachments::MAX_SHARED / 1_048_576;
            return Err(AppError::Invalid(crate::tr!(
                "{} : trop lourd pour un autre appareil (max {max} Mo)",
                "{}: too large for another device (max {max} MB)",
                a.name
            )));
        }
        let data = base64::engine::general_purpose::STANDARD.encode(tokio::fs::read(&a.path).await?);
        let args = json!({ "name": a.name, "mime": a.mime, "data": data });
        let copy = node.call(&device, RpcRequest { method: "paste_attachment".into(), args }).await?;
        uploaded.push(serde_json::from_value(copy)?);
    }
    Ok(uploaded)
}

/// Files of a chat on a paired host (attachments, images its agent made), copied into a local cache once so the
/// chat displays them. A file the host refuses or can't send is left out.
#[tauri::command]
pub async fn remote_fetch_attachments(
    state: State<'_, Shared>,
    device: String,
    thread_id: String,
    attachments: Vec<Attachment>,
) -> AppResult<Vec<Attachment>> {
    let node = host_node(&state, &device).await?;
    // Inside the attachments folder: the webview may load it (asset protocol scope).
    let cache = attachments::root(&state.paths.data_dir).join("remote").join(device.get(..16).unwrap_or(&device));
    let mut local = Vec::new();
    for a in attachments {
        let key = blake3::hash(a.path.as_bytes()).to_hex();
        let path = cache.join(&key.as_str()[..16]).join(attachments::safe_name(&a.name));
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            let args = json!({ "threadId": thread_id, "path": a.path });
            let fetched = node.call(&device, RpcRequest { method: "read_attachment".into(), args }).await;
            let file: SharedFile = match fetched.and_then(|v| Ok(serde_json::from_value(v)?)) {
                Ok(file) => file,
                Err(err) => {
                    tracing::debug!(%err, name = %a.name, "remote: attachment not fetched");
                    continue;
                }
            };
            let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(file.data) else { continue };
            if let Some(dir) = path.parent() {
                tokio::fs::create_dir_all(dir).await?;
            }
            tokio::fs::write(&path, bytes).await?;
        }
        local.push(Attachment { path: path.display().to_string(), ..a });
    }
    Ok(local)
}
