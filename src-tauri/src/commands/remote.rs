//! Remote devices: settings, pairing, paired devices and calls to a paired host (see `crate::remote`).

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::db::remote::{self as store, AccessLevel, RemoteClient, RemoteHost};
use crate::error::{AppError, AppResult};
use crate::remote::node::NearbyDevice;
use crate::remote::pairing::PairingCode;
use crate::remote::protocol::RpcRequest;
use crate::remote::{self, RemoteSettings};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, TS)]
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

#[derive(Debug, Clone, Serialize, TS)]
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

#[tauri::command]
pub async fn remote_status(state: State<'_, AppState>) -> AppResult<RemoteStatus> {
    status(&state).await
}

/// Allow (or stop allowing) other devices to pair with and control this one.
#[tauri::command]
pub async fn remote_set_enabled(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> AppResult<RemoteStatus> {
    state
        .db
        .call(move |c| {
            let mut settings = remote::load_settings(c)?;
            settings.enabled = enabled;
            remote::save_settings(c, &settings)
        })
        .await?;
    state.remote.sync(&app).await?;
    status(&state).await
}

#[tauri::command]
pub async fn remote_set_device_name(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> AppResult<RemoteStatus> {
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
    state.remote.sync(&app).await?;
    status(&state).await
}

/// Opens a pairing window on this device: the code to type on the other one (2 minutes, 3 attempts).
#[tauri::command]
pub async fn remote_start_pairing(app: AppHandle, state: State<'_, AppState>) -> AppResult<PairingCode> {
    state.remote.ensure(&app).await?.open_pairing()
}

#[tauri::command]
pub async fn remote_cancel_pairing(state: State<'_, AppState>) -> AppResult<()> {
    if let Some(node) = state.remote.node().await {
        node.cancel_pairing();
    }
    Ok(())
}

/// Neuron instances that accept connections on the local network (starts listening if needed).
#[tauri::command]
pub async fn remote_nearby(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<NearbyDevice>> {
    Ok(state.remote.ensure(&app).await?.nearby())
}

/// Pairs with a nearby device showing `code`; this device can then control it. Returns its name.
#[tauri::command]
pub async fn remote_pair(
    app: AppHandle,
    state: State<'_, AppState>,
    node_id: String,
    code: String,
) -> AppResult<String> {
    let node = state.remote.ensure(&app).await?;
    let name = node.pair(&node_id, &code).await?;
    // Connect right away: its chats and events show up without waiting.
    if let Err(err) = node.connect_host(&node_id).await {
        tracing::debug!(%err, "remote: first connection after pairing failed");
    }
    Ok(name)
}

#[tauri::command]
pub async fn remote_devices(state: State<'_, AppState>) -> AppResult<RemoteDevices> {
    let (mut clients, mut hosts) = state.db.call(|c| Ok((store::list_clients(c)?, store::list_hosts(c)?))).await?;
    if let Some(node) = state.remote.node().await {
        let (live_clients, live_hosts) = (node.connected_clients(), node.connected_hosts());
        for c in &mut clients {
            c.connected = live_clients.contains(&c.node_id);
        }
        for h in &mut hosts {
            h.connected = live_hosts.contains(&h.node_id);
        }
    }
    Ok(RemoteDevices { clients, hosts })
}

/// What a paired client may do on this device (applies to its next request).
#[tauri::command]
pub async fn remote_set_level(state: State<'_, AppState>, node_id: String, level: AccessLevel) -> AppResult<()> {
    state.db.call(move |c| store::set_client_level(c, &node_id, level)).await
}

/// A paired client loses access right away (its connections are closed).
#[tauri::command]
pub async fn remote_revoke(state: State<'_, AppState>, node_id: String) -> AppResult<()> {
    let id = node_id.clone();
    state.db.call(move |c| store::delete_client(c, &id)).await?;
    if let Some(node) = state.remote.node().await {
        node.drop_client(&node_id);
    }
    Ok(())
}

/// This device stops controlling a host.
#[tauri::command]
pub async fn remote_forget(app: AppHandle, state: State<'_, AppState>, node_id: String) -> AppResult<()> {
    let id = node_id.clone();
    state.db.call(move |c| store::delete_host(c, &id)).await?;
    if let Some(node) = state.remote.node().await {
        node.drop_host(&node_id);
    }
    state.remote.sync(&app).await?;
    Ok(())
}

/// A command run on a paired host (same name and arguments as the local `invoke`); its result as JSON.
#[tauri::command]
pub async fn remote_call(
    app: AppHandle,
    state: State<'_, AppState>,
    device: String,
    method: String,
    args: Option<Value>,
) -> AppResult<Value> {
    let probe = device.clone();
    let paired = state.db.call(move |c| Ok(store::list_hosts(c)?.iter().any(|h| h.node_id == probe))).await?;
    if !paired {
        return Err(AppError::NotFound(crate::tr!("appareil non appairé", "device not paired")));
    }
    let node = state.remote.ensure(&app).await?;
    node.call(&device, RpcRequest { method, args: args.unwrap_or(Value::Null) }).await
}
