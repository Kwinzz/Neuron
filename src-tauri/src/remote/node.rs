//! One iroh endpoint per Neuron instance: hosts the paired clients that control this device (when access is
//! enabled) and connects to the paired hosts this device controls. Independent of Tauri: everything app-specific
//! (database, dispatch to the commands, frontend events) goes through [`Backend`], so the networking is tested
//! with two in-process nodes.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6};
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use iroh::address_lookup::MemoryLookup;
use iroh::endpoint::{BindOpts, Connection, Incoming, RecvStream, SendStream, presets};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, SecretKey};
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use ts_rs::TS;

use super::mdns::{DiscoveryEvent, MdnsLookup};
use super::pairing::{Exchange, PairingCode, PairingWindow, Role, wrong_code};
use super::protocol::{
    MAX_MESSAGE, PAIR_ALPN, PairConfirm, PairHello, PairOutcome, PairReply, RPC_ALPN, RpcRequest, RpcResponse,
    WireEvent, net_err, read_frame, write_frame,
};
use crate::db::remote::AccessLevel;
use crate::error::{AppError, AppResult};
use crate::util::now_ms;

pub type BoxFut<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// mDNS service under which Neuron instances find each other (other iroh apps are ignored).
const MDNS_SERVICE: &str = "neuron";
/// Preferred UDP port when hosting other devices, so firewalls (e.g. ufw on Linux) only need one rule.
/// Falls back to an ephemeral OS port if already in use.
pub const DEFAULT_HOST_PORT: u16 = 47831;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
/// A request may start a CLI (`agent_access`, `list_models`): generous.
const CALL_TIMEOUT: Duration = Duration::from_secs(90);
/// Sent to a client whose event stream fell behind: it reloads its lists instead of trusting partial updates.
pub const RESYNC_CHANNEL: &str = "remote://resync";

/// What the networking needs from the app.
pub trait Backend: Send + Sync + 'static {
    /// Level granted to a paired client (`None` = not paired, connection refused).
    fn client_level(&self, client: String) -> BoxFut<Option<AccessLevel>>;
    /// Runs a request of a paired client.
    fn call(&self, client: String, level: AccessLevel, request: RpcRequest) -> BoxFut<AppResult<Value>>;
    /// Runs a reverse request sent by a paired host over an already-established client → host connection
    /// (used exclusively for grant-authorized cross-device workspace tools).
    fn reverse_call(&self, _host: String, _request: RpcRequest) -> BoxFut<AppResult<Value>> {
        Box::pin(async { Err(AppError::Invalid("reverse call not supported".into())) })
    }
    /// A client just paired with this device (default level: full).
    fn client_paired(&self, client: String, name: String) -> BoxFut<AppResult<()>>;
    /// This device just paired with a host.
    fn host_paired(&self, host: String, name: String) -> BoxFut<AppResult<()>>;
    fn client_seen(&self, client: String);
    fn host_seen(&self, host: String);
    /// An event of a host this device is connected to.
    fn host_event(&self, host: String, event: WireEvent);
    /// A Neuron instance showed up on the local network (mDNS).
    fn discovered(&self, id: String);
    /// Connections, nearby devices or the pairing window changed (the UI refreshes its list).
    fn changed(&self);
}

/// A Neuron instance found on the local network.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NearbyDevice {
    pub node_id: String,
    pub name: String,
}

pub struct NodeConfig {
    pub secret: SecretKey,
    /// Name shown to the other devices.
    pub name: String,
    /// Accept paired clients (and pairing requests).
    pub hosting: bool,
    /// Local network discovery (off in tests).
    pub mdns: bool,
    /// Bind [`DEFAULT_HOST_PORT`] when hosting (with ephemeral fallback if busy; off in tests).
    pub fixed_port: bool,
    /// Reachable outside the local network: n0's public relays (NAT traversal, fallback path) and its address
    /// directory keyed by endpoint id. Off = local network only, nothing leaves the LAN.
    pub internet: bool,
}

/// How a connection to a host currently goes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HostPath {
    /// Through a public relay (no direct path found yet).
    pub via_relay: bool,
    /// Round-trip time of the path in use, in ms.
    pub rtt_ms: u32,
}

/// Private, link-local or loopback address: the peer is on the local network.
fn is_local_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_loopback(),
        std::net::IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

/// A pairing attempt is served from the local network, or from anywhere while a window opened in internet mode
/// (the invitation) is open.
fn pairing_allowed(local: bool, window_internet: bool) -> bool {
    local || window_internet
}

/// The connection runs over a direct path to a local-network address.
fn is_local_connection(conn: &Connection) -> bool {
    conn.paths()
        .iter()
        .find(|p| p.is_selected())
        .is_some_and(|p| matches!(p.remote_addr(), iroh::TransportAddr::Ip(addr) if is_local_ip(addr.ip())))
}

pub struct Node {
    endpoint: Endpoint,
    addresses: MemoryLookup,
    backend: Arc<dyn Backend>,
    events: broadcast::Sender<WireEvent>,
    name: String,
    hosting: bool,
    internet: bool,
    pairing: Mutex<Option<PairingWindow>>,
    /// Inbound connections of paired clients, by client.
    clients: Mutex<HashMap<EndpointId, Vec<Connection>>>,
    /// Outbound connections to paired hosts.
    hosts: Mutex<HashMap<EndpointId, Connection>>,
    connecting: tokio::sync::Mutex<()>,
    nearby: Mutex<HashMap<EndpointId, String>>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

/// Poisoned locks only follow a panic elsewhere; the data stays usable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Device names come from the other side: trimmed and bounded.
pub fn clean_name(name: &str) -> String {
    let name: String = name.trim().chars().filter(|c| !c.is_control()).take(64).collect();
    if name.is_empty() { crate::i18n::pick("Appareil", "Device").to_string() } else { name }
}

fn parse_id(id: &str) -> AppResult<EndpointId> {
    id.parse().map_err(|_| AppError::Invalid(crate::tr!("identifiant d'appareil invalide", "invalid device id")))
}

impl Node {
    /// Binds the endpoint (local network only: no relay, no DNS) and starts serving. `events`: the host's event
    /// bus, forwarded to every connected client.
    pub async fn start(
        config: NodeConfig,
        backend: Arc<dyn Backend>,
        events: broadcast::Sender<WireEvent>,
    ) -> AppResult<Arc<Self>> {
        let name = clean_name(&config.name);
        let endpoint = bind_endpoint(&config, &name).await?;
        let addresses = MemoryLookup::new();
        endpoint.address_lookup().map_err(net_err)?.add(addresses.clone());
        let mdns = if config.mdns {
            let mdns = MdnsLookup::start(endpoint.id(), MDNS_SERVICE, config.hosting).await?;
            endpoint.address_lookup().map_err(net_err)?.add(mdns.clone());
            Some(mdns)
        } else {
            None
        };

        let node = Arc::new(Self {
            endpoint,
            addresses,
            backend,
            events,
            name,
            hosting: config.hosting,
            internet: config.internet,
            pairing: Mutex::new(None),
            clients: Mutex::new(HashMap::new()),
            hosts: Mutex::new(HashMap::new()),
            connecting: tokio::sync::Mutex::new(()),
            nearby: Mutex::new(HashMap::new()),
            tasks: Mutex::new(Vec::new()),
        });

        if config.hosting {
            let weak = Arc::downgrade(&node);
            let endpoint = node.endpoint.clone();
            node.spawn(async move {
                while let Some(incoming) = endpoint.accept().await {
                    let Some(node) = weak.upgrade() else { break };
                    tokio::spawn(node.serve(incoming));
                }
            });
        }
        if let Some(mdns) = mdns {
            let weak = Arc::downgrade(&node);
            let own = node.id();
            node.spawn(async move {
                let mut discovered = mdns.subscribe().await;
                while let Some(event) = discovered.next().await {
                    let Some(node) = weak.upgrade() else { break };
                    match event {
                        DiscoveryEvent::Discovered { endpoint_info, .. } if endpoint_info.endpoint_id != own => {
                            let name = endpoint_info.data.user_data().map(|u| clean_name(u.as_ref()));
                            let id = endpoint_info.endpoint_id;
                            lock(&node.nearby).insert(id, name.unwrap_or_else(|| clean_name("")));
                            node.backend.discovered(id.to_string());
                            node.backend.changed();
                        }
                        DiscoveryEvent::Expired { endpoint_id } => {
                            lock(&node.nearby).remove(&endpoint_id);
                            node.backend.changed();
                        }
                        _ => {}
                    }
                }
            });
        }
        Ok(node)
    }

    /// Runs a task for the node's lifetime (aborted by [`Node::shutdown`]).
    pub fn spawn(&self, task: impl Future<Output = ()> + Send + 'static) {
        lock(&self.tasks).push(tokio::spawn(task));
    }

    pub fn id(&self) -> EndpointId {
        self.endpoint.id()
    }

    pub fn is_hosting(&self) -> bool {
        self.hosting
    }

    /// Name shown to the other devices.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// UDP port this endpoint is listening on (IPv4 preferred).
    pub fn port(&self) -> Option<u16> {
        let sockets = self.endpoint.bound_sockets();
        sockets.iter().find(|s| s.is_ipv4()).or_else(|| sockets.first()).map(SocketAddr::port)
    }

    /// This node's address (tests, and later remembering where a host was reached).
    pub fn addr(&self) -> EndpointAddr {
        self.endpoint.addr()
    }

    /// Teaches the node where another one can be reached (no discovery needed).
    pub fn add_addr(&self, addr: EndpointAddr) {
        self.addresses.add_endpoint_info(addr);
    }

    pub fn nearby(&self) -> Vec<NearbyDevice> {
        let mut list: Vec<NearbyDevice> = lock(&self.nearby)
            .iter()
            .map(|(id, name)| NearbyDevice { node_id: id.to_string(), name: name.clone() })
            .collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    pub fn connected_clients(&self) -> HashSet<String> {
        lock(&self.clients)
            .iter()
            .filter(|(_, conns)| conns.iter().any(|c| c.close_reason().is_none()))
            .map(|(id, _)| id.to_string())
            .collect()
    }

    pub fn is_internet(&self) -> bool {
        self.internet
    }

    /// Path of the live connection to a host, if any.
    pub fn host_path(&self, host: &str) -> Option<HostPath> {
        let id = parse_id(host).ok()?;
        let hosts = lock(&self.hosts);
        let conn = hosts.get(&id).filter(|c| c.close_reason().is_none())?;
        let paths = conn.paths();
        let path = paths.iter().find(|p| p.is_selected())?;
        Some(HostPath { via_relay: path.is_relay(), rtt_ms: u32::try_from(path.rtt().as_millis()).unwrap_or(u32::MAX) })
    }

    pub fn connected_hosts(&self) -> HashSet<String> {
        lock(&self.hosts).iter().filter(|(_, c)| c.close_reason().is_none()).map(|(id, _)| id.to_string()).collect()
    }

    // --- Pairing window (host side) ---

    pub fn open_pairing(&self) -> AppResult<PairingCode> {
        if !self.hosting {
            return Err(AppError::Invalid(crate::tr!(
                "active d'abord l'accès depuis d'autres appareils",
                "enable access from other devices first"
            )));
        }
        let window = PairingWindow::open(now_ms(), self.internet);
        let code = window.code.clone();
        *lock(&self.pairing) = Some(window);
        self.backend.changed();
        Ok(code)
    }

    pub fn cancel_pairing(&self) {
        *lock(&self.pairing) = None;
        self.backend.changed();
    }

    /// Invitation of the open pairing window, when a device outside the local network may use it.
    pub fn invite(&self) -> Option<String> {
        let code = self.pairing()?;
        let internet = lock(&self.pairing).as_ref().is_some_and(|w| w.internet);
        internet.then(|| super::pairing::invite(&self.id().to_string(), &code.code))
    }

    /// The open pairing code, if any.
    pub fn pairing(&self) -> Option<PairingCode> {
        let mut guard = lock(&self.pairing);
        match guard.as_ref() {
            Some(w) if w.is_open(now_ms()) => Some(w.code.clone()),
            Some(_) => {
                *guard = None;
                None
            }
            None => None,
        }
    }

    fn pairing_failed(&self) {
        {
            let mut guard = lock(&self.pairing);
            if let Some(w) = guard.as_mut() {
                w.failures += 1;
                if !w.is_open(now_ms()) {
                    *guard = None;
                }
            }
        }
        self.backend.changed();
    }

    // --- Host side: serving paired clients ---

    async fn serve(self: Arc<Self>, incoming: Incoming) {
        let conn = match incoming.await {
            Ok(conn) => conn,
            Err(err) => {
                tracing::debug!(%err, "remote: incoming connection failed");
                return;
            }
        };
        if conn.alpn() == PAIR_ALPN {
            self.serve_pairing(conn).await;
        } else if conn.alpn() == RPC_ALPN {
            self.serve_rpc(conn).await;
        } else {
            conn.close(1u32.into(), b"unknown protocol");
        }
    }

    async fn serve_pairing(self: Arc<Self>, conn: Connection) {
        let peer = conn.remote_id();
        // Pairing stays a local-network gesture, unless the window was opened in internet mode (invitation).
        let window_internet = lock(&self.pairing).as_ref().is_some_and(|w| w.internet && w.is_open(now_ms()));
        if !pairing_allowed(is_local_connection(&conn), window_internet) {
            tracing::warn!(peer = %peer.fmt_short(), "remote: pairing refused, not from the local network");
            conn.close(4u32.into(), b"pairing is local only");
            return;
        }
        let Ok((mut send, mut recv)) = conn.accept_bi().await else { return };
        if let Err(err) = self.pairing_exchange(peer, &mut send, &mut recv).await {
            tracing::info!(%err, peer = %peer.fmt_short(), "remote: pairing failed");
        }
        let _ = send.finish();
        // Let the client read the outcome before the connection goes away.
        let _ = tokio::time::timeout(Duration::from_secs(5), conn.closed()).await;
    }

    async fn pairing_exchange(&self, peer: EndpointId, send: &mut SendStream, recv: &mut RecvStream) -> AppResult<()> {
        let hello: PairHello = read_frame(recv).await?;
        let Some(code) = self.pairing() else {
            let reason =
                crate::tr!("aucun appairage en cours sur cet appareil", "no pairing in progress on that device");
            return write_frame(send, &PairReply::Refused { reason }).await;
        };
        let (exchange, message) = Exchange::start(Role::Host, &code.code, *peer.as_bytes(), *self.id().as_bytes());
        let keys = match exchange.finish(&hello.spake) {
            Ok(keys) => keys,
            Err(_) => {
                self.pairing_failed();
                return write_frame(send, &PairReply::Refused { reason: wrong_code() }).await;
            }
        };
        let reply = PairReply::Continue { name: self.name.clone(), spake: message, confirm: keys.own_confirmation() };
        write_frame(send, &reply).await?;
        let confirm: PairConfirm = read_frame(recv).await?;
        if !keys.verify(&confirm.confirm) {
            self.pairing_failed();
            return write_frame(send, &PairOutcome { ok: false, reason: Some(wrong_code()) }).await;
        }
        *lock(&self.pairing) = None;
        self.backend.client_paired(peer.to_string(), clean_name(&hello.name)).await?;
        tracing::info!(peer = %peer.fmt_short(), "remote: device paired");
        self.backend.changed();
        write_frame(send, &PairOutcome { ok: true, reason: None }).await
    }

    async fn serve_rpc(self: Arc<Self>, conn: Connection) {
        let peer = conn.remote_id();
        let client = peer.to_string();
        if self.backend.client_level(client.clone()).await.is_none() {
            conn.close(2u32.into(), b"not paired");
            return;
        }
        lock(&self.clients).entry(peer).or_default().push(conn.clone());
        self.backend.client_seen(client.clone());
        self.backend.changed();

        // Events of this device, pushed to the client as they happen.
        let mut rx = self.events.subscribe();
        let events_conn = conn.clone();
        let forward = tokio::spawn(async move {
            let Ok(mut send) = events_conn.open_uni().await else { return };
            loop {
                let event = match rx.recv().await {
                    Ok(event) => event,
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        WireEvent { channel: RESYNC_CHANNEL.into(), payload: Value::Null }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                if write_frame(&mut send, &event).await.is_err() {
                    break;
                }
            }
        });

        while let Ok((send, recv)) = conn.accept_bi().await {
            let node = Arc::clone(&self);
            let client = client.clone();
            tokio::spawn(async move { node.answer(client, send, recv).await });
        }
        forward.abort();
        if let Some(conns) = lock(&self.clients).get_mut(&peer) {
            conns.retain(|c| c.stable_id() != conn.stable_id());
        }
        self.backend.changed();
    }

    async fn answer(&self, client: String, mut send: SendStream, mut recv: RecvStream) {
        let Ok(bytes) = recv.read_to_end(MAX_MESSAGE).await else { return };
        let result = match serde_json::from_slice::<RpcRequest>(&bytes) {
            // Level read again for every request: a change or a revocation applies right away.
            Ok(request) => match self.backend.client_level(client.clone()).await {
                Some(level) => self.backend.call(client, level, request).await,
                None => Err(AppError::Invalid(crate::tr!("appareil non appairé", "device not paired"))),
            },
            Err(err) => Err(AppError::Invalid(format!("bad request: {err}"))),
        };
        let response = RpcResponse::from_result(result);
        if let Ok(bytes) = serde_json::to_vec(&response) {
            let _ = send.write_all(&bytes).await;
        }
        let _ = send.finish();
    }

    /// Closes every connection of a client (revoked).
    pub fn drop_client(&self, client: &str) {
        let Ok(id) = parse_id(client) else { return };
        if let Some(conns) = lock(&self.clients).remove(&id) {
            for conn in conns {
                conn.close(3u32.into(), b"revoked");
            }
        }
        self.backend.changed();
    }

    // --- Client side: controlling paired hosts ---

    /// The live connection to a host, opened when needed (its events start flowing to [`Backend::host_event`]).
    pub async fn connect_host(self: &Arc<Self>, host: &str) -> AppResult<Connection> {
        let id = parse_id(host)?;
        let live = |node: &Self| lock(&node.hosts).get(&id).filter(|c| c.close_reason().is_none()).cloned();
        if let Some(conn) = live(self) {
            return Ok(conn);
        }
        let _one_at_a_time = self.connecting.lock().await;
        if let Some(conn) = live(self) {
            return Ok(conn);
        }
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(id, RPC_ALPN))
            .await
            .map_err(|_| AppError::Other(crate::tr!("appareil injoignable", "device unreachable")))?
            .map_err(net_err)?;
        lock(&self.hosts).insert(id, conn.clone());
        self.backend.host_seen(host.to_string());
        self.backend.changed();

        let weak: Weak<Self> = Arc::downgrade(self);
        let events_conn = conn.clone();
        let rev_conn = conn.clone();
        let rev_host = host.to_string();
        let rev_weak = Arc::downgrade(self);
        let reverse_task = tokio::spawn(async move {
            while let Ok((send, recv)) = rev_conn.accept_bi().await {
                let Some(node) = rev_weak.upgrade() else { break };
                let peer = rev_host.clone();
                tokio::spawn(async move { node.answer_reverse(peer, send, recv).await });
            }
        });
        let host = host.to_string();
        self.spawn(async move {
            if let Ok(mut recv) = events_conn.accept_uni().await {
                while let Ok(event) = read_frame::<WireEvent>(&mut recv).await {
                    let Some(node) = weak.upgrade() else {
                        reverse_task.abort();
                        return;
                    };
                    node.backend.host_event(host.clone(), event);
                }
            }
            let reason = events_conn.closed().await;
            reverse_task.abort();
            tracing::info!(%reason, host = %host, "remote: host connection ended");
            if let Some(node) = weak.upgrade() {
                let mut hosts = lock(&node.hosts);
                if hosts.get(&id).is_some_and(|c| c.stable_id() == events_conn.stable_id()) {
                    hosts.remove(&id);
                }
                drop(hosts);
                node.backend.changed();
            }
        });
        Ok(conn)
    }

    async fn answer_reverse(&self, host: String, mut send: SendStream, mut recv: RecvStream) {
        let Ok(bytes) = recv.read_to_end(MAX_MESSAGE).await else { return };
        let result = match serde_json::from_slice::<RpcRequest>(&bytes) {
            Ok(request) => self.backend.reverse_call(host, request).await,
            Err(err) => Err(AppError::Invalid(format!("bad request: {err}"))),
        };
        let response = RpcResponse::from_result(result);
        if let Ok(bytes) = serde_json::to_vec(&response) {
            let _ = send.write_all(&bytes).await;
        }
        let _ = send.finish();
    }

    async fn exchange_on(conn: &Connection, request: &RpcRequest, timeout: Duration) -> AppResult<Value> {
        let exchange = async {
            let (mut send, mut recv) = conn.open_bi().await.map_err(net_err)?;
            send.write_all(&serde_json::to_vec(request)?).await.map_err(net_err)?;
            send.finish().map_err(net_err)?;
            let bytes = recv.read_to_end(MAX_MESSAGE).await.map_err(net_err)?;
            Ok::<_, AppError>(serde_json::from_slice::<RpcResponse>(&bytes)?)
        };
        let response = tokio::time::timeout(timeout, exchange)
            .await
            .map_err(|_| AppError::Other(crate::tr!("l'appareil n'a pas répondu", "the device did not answer")))??;
        response.into_result()
    }

    /// One request to a paired host with a custom timeout.
    pub async fn call_with_timeout(
        self: &Arc<Self>,
        host: &str,
        request: RpcRequest,
        timeout: Duration,
    ) -> AppResult<Value> {
        let conn = self.connect_host(host).await?;
        Self::exchange_on(&conn, &request, timeout).await
    }

    /// One request to a paired host (default timeout).
    pub async fn call(self: &Arc<Self>, host: &str, request: RpcRequest) -> AppResult<Value> {
        self.call_with_timeout(host, request, CALL_TIMEOUT).await
    }

    /// Calls a connected peer over whichever live connection exists:
    /// 1) outbound connection to a paired host, else
    /// 2) reverse bi-stream on an active inbound connection from a paired client, else
    /// 3) dials the peer as a paired host (reconnect).
    pub async fn call_peer(self: &Arc<Self>, peer: &str, request: RpcRequest, timeout: Duration) -> AppResult<Value> {
        let id = parse_id(peer)?;
        let outbound = lock(&self.hosts).get(&id).filter(|c| c.close_reason().is_none()).cloned();
        if let Some(conn) = outbound {
            return Self::exchange_on(&conn, &request, timeout).await;
        }
        let inbound = lock(&self.clients)
            .get(&id)
            .and_then(|conns| conns.iter().rev().find(|c| c.close_reason().is_none()).cloned());
        if let Some(conn) = inbound {
            return Self::exchange_on(&conn, &request, timeout).await;
        }
        self.call_with_timeout(peer, request, timeout).await
    }

    /// Closes the connection to a host (forgotten).
    pub fn drop_host(&self, host: &str) {
        let Ok(id) = parse_id(host) else { return };
        if let Some(conn) = lock(&self.hosts).remove(&id) {
            conn.close(0u32.into(), b"forgotten");
        }
        self.backend.changed();
    }

    /// Pairs with a host showing `code`; returns the host's name. The host is stored through
    /// [`Backend::host_paired`].
    pub async fn pair(&self, host: &str, code: &str) -> AppResult<String> {
        let id = parse_id(host)?;
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(id, PAIR_ALPN))
            .await
            .map_err(|_| AppError::Other(crate::tr!("appareil injoignable", "device unreachable")))?
            .map_err(net_err)?;
        let result = async {
            let (mut send, mut recv) = conn.open_bi().await.map_err(net_err)?;
            let (exchange, message) = Exchange::start(Role::Client, code, *self.id().as_bytes(), *id.as_bytes());
            write_frame(&mut send, &PairHello { name: self.name.clone(), spake: message }).await?;
            let (name, spake, confirm) = match read_frame::<PairReply>(&mut recv).await? {
                PairReply::Refused { reason } => return Err(AppError::Invalid(reason)),
                PairReply::Continue { name, spake, confirm } => (name, spake, confirm),
            };
            let keys = exchange.finish(&spake)?;
            // Wrong code: still answer, so the host counts the failed attempt.
            let ours = if keys.verify(&confirm) { keys.own_confirmation() } else { Vec::new() };
            write_frame(&mut send, &PairConfirm { confirm: ours }).await?;
            let outcome: PairOutcome = read_frame(&mut recv).await?;
            let _ = send.finish();
            if !outcome.ok {
                return Err(AppError::Invalid(outcome.reason.unwrap_or_else(wrong_code)));
            }
            Ok(clean_name(&name))
        }
        .await;
        conn.close(0u32.into(), b"done");
        let name = result?;
        self.backend.host_paired(host.to_string(), name.clone()).await?;
        self.backend.changed();
        Ok(name)
    }

    /// Stops every task and closes the endpoint.
    pub async fn shutdown(&self) {
        for task in lock(&self.tasks).drain(..) {
            task.abort();
        }
        if let Ok(lookup) = self.endpoint.address_lookup() {
            lookup.clear();
        }
        self.endpoint.close().await;
    }
}

fn endpoint_builder(secret: SecretKey, name: &str, hosting: bool, internet: bool) -> iroh::endpoint::Builder {
    let alpns = if hosting { vec![PAIR_ALPN.to_vec(), RPC_ALPN.to_vec()] } else { Vec::new() };
    let builder = if internet {
        // Public relays + address directory: a paired device is found by its id wherever it is.
        Endpoint::builder(presets::N0)
    } else {
        Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled)
    };
    let mut builder = builder.secret_key(secret).alpns(alpns);
    // The name travels with the address info (mDNS, and the address directory when reachable from the internet:
    // readable there only by whoever already knows this device's id).
    if hosting {
        let mut advertised = name.to_string();
        while advertised.len() > iroh::address_lookup::UserData::MAX_LENGTH {
            advertised.pop();
        }
        if let Ok(user_data) = advertised.try_into() {
            builder = builder.user_data_for_address_lookup(user_data);
        }
    }
    builder
}

async fn bind_endpoint(config: &NodeConfig, name: &str) -> AppResult<Endpoint> {
    if config.hosting && config.fixed_port {
        let fixed = endpoint_builder(config.secret.clone(), name, true, config.internet)
            .clear_ip_transports()
            .bind_addr(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, DEFAULT_HOST_PORT))
            .and_then(|b| {
                b.bind_addr_with_opts(
                    SocketAddrV6::new(Ipv6Addr::UNSPECIFIED, DEFAULT_HOST_PORT, 0, 0),
                    BindOpts::default().set_is_required(false),
                )
            });
        match fixed {
            Ok(builder) => match builder.bind().await {
                Ok(endpoint) => return Ok(endpoint),
                Err(err) => tracing::warn!(
                    port = DEFAULT_HOST_PORT,
                    %err,
                    "remote: fixed host port busy, falling back to ephemeral port"
                ),
            },
            Err(err) => tracing::warn!(%err, "remote: fixed host bind addr invalid, falling back to ephemeral port"),
        }
    }
    endpoint_builder(config.secret.clone(), name, config.hosting, config.internet).bind().await.map_err(net_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pairing_from_outside_needs_an_internet_window() {
        assert!(pairing_allowed(true, false));
        assert!(pairing_allowed(true, true));
        assert!(pairing_allowed(false, true));
        assert!(!pairing_allowed(false, false));
    }
    use tokio::sync::mpsc;

    /// In-memory backend: paired devices in maps, calls echoed back, host events sent to a channel.
    #[derive(Default)]
    struct Mock {
        clients: Mutex<HashMap<String, AccessLevel>>,
        hosts: Mutex<HashMap<String, String>>,
        events: Mutex<Option<mpsc::UnboundedSender<WireEvent>>>,
    }

    impl Backend for Mock {
        fn client_level(&self, client: String) -> BoxFut<Option<AccessLevel>> {
            let level = lock(&self.clients).get(&client).copied();
            Box::pin(async move { level })
        }
        fn call(&self, client: String, level: AccessLevel, request: RpcRequest) -> BoxFut<AppResult<Value>> {
            Box::pin(async move {
                if request.method == "fail" {
                    return Err(AppError::NotFound("thread x".into()));
                }
                Ok(json!({ "client": client, "level": level.as_str(), "method": request.method, "args": request.args }))
            })
        }
        fn reverse_call(&self, host: String, request: RpcRequest) -> BoxFut<AppResult<Value>> {
            Box::pin(async move {
                if request.method != "workspace_op" {
                    return Err(AppError::Invalid("refused".into()));
                }
                Ok(json!({ "reverseHost": host, "args": request.args }))
            })
        }
        fn client_paired(&self, client: String, _name: String) -> BoxFut<AppResult<()>> {
            lock(&self.clients).insert(client, AccessLevel::Full);
            Box::pin(async { Ok(()) })
        }
        fn host_paired(&self, host: String, name: String) -> BoxFut<AppResult<()>> {
            lock(&self.hosts).insert(host, name);
            Box::pin(async { Ok(()) })
        }
        fn client_seen(&self, _client: String) {}
        fn host_seen(&self, _host: String) {}
        fn host_event(&self, _host: String, event: WireEvent) {
            if let Some(tx) = lock(&self.events).as_ref() {
                let _ = tx.send(event);
            }
        }
        fn discovered(&self, _id: String) {}
        fn changed(&self) {}
    }

    async fn node(name: &str, hosting: bool) -> (Arc<Node>, Arc<Mock>, broadcast::Sender<WireEvent>) {
        let backend = Arc::new(Mock::default());
        let (events, _) = broadcast::channel(64);
        let config = NodeConfig {
            secret: SecretKey::generate(),
            name: name.into(),
            hosting,
            mdns: false,
            fixed_port: false,
            internet: false,
        };
        let node = Node::start(config, backend.clone(), events.clone()).await.unwrap();
        (node, backend, events)
    }

    #[tokio::test]
    async fn pair_call_events_and_revoke() {
        let (host, host_backend, host_events) = node("PC", true).await;
        let (client, client_backend, _) = node("Portable", false).await;
        client.add_addr(host.addr());
        let host_id = host.id().to_string();
        let client_id = client.id().to_string();

        // Not paired yet: requests are refused.
        assert!(client.call(&host_id, RpcRequest { method: "list_threads".into(), args: json!({}) }).await.is_err());
        client.drop_host(&host_id);

        // No pairing window: refused. Wrong code: refused and counted.
        assert!(client.pair(&host_id, "123456").await.is_err());
        let code = host.open_pairing().unwrap();
        // Local network only (no internet mode): no invitation.
        assert!(host.invite().is_none());
        let wrong = if code.code == "000000" { "111111" } else { "000000" };
        assert!(client.pair(&host_id, wrong).await.is_err());
        assert!(host.pairing().is_some(), "one failure leaves the window open");

        // Right code: both sides remember each other.
        assert_eq!(client.pair(&host_id, &code.code).await.unwrap(), "PC");
        assert!(host.pairing().is_none(), "the window closes once used");
        assert_eq!(lock(&host_backend.clients).get(&client_id), Some(&AccessLevel::Full));
        assert_eq!(lock(&client_backend.hosts).get(&host_id).map(String::as_str), Some("PC"));

        // Requests carry the client's identity and level; errors keep their kind.
        let value = client
            .call(&host_id, RpcRequest { method: "list_threads".into(), args: json!({"limit": 3}) })
            .await
            .unwrap();
        assert_eq!(value["client"], client_id);
        assert_eq!(value["level"], "full");
        assert_eq!(value["args"]["limit"], 3);
        let err = client.call(&host_id, RpcRequest { method: "fail".into(), args: Value::Null }).await;
        assert!(matches!(err, Err(AppError::NotFound(_))));
        assert!(host.connected_clients().contains(&client_id));
        assert!(client.connected_hosts().contains(&host_id));

        // Host events reach the connected client.
        let (tx, mut rx) = mpsc::unbounded_channel();
        *lock(&client_backend.events) = Some(tx);
        let event = WireEvent { channel: "agent://event".into(), payload: json!({"threadId": "t"}) };
        host_events.send(event.clone()).unwrap();
        let received = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
        assert_eq!(received, event);

        // Reverse call (host → client) travels over the client's existing inbound connection.
        let rev = host
            .call_peer(
                &client_id,
                RpcRequest { method: "workspace_op".into(), args: json!({ "grantId": "g1" }) },
                Duration::from_secs(5),
            )
            .await
            .unwrap();
        assert_eq!(rev["reverseHost"], host_id);
        assert_eq!(rev["args"]["grantId"], "g1");
        assert!(
            host.call_peer(&client_id, RpcRequest { method: "nope".into(), args: Value::Null }, Duration::from_secs(5))
                .await
                .is_err()
        );

        // Revoked: the connection drops and new requests are refused.
        lock(&host_backend.clients).remove(&client_id);
        host.drop_client(&client_id);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(client.call(&host_id, RpcRequest { method: "list_threads".into(), args: json!({}) }).await.is_err());

        client.shutdown().await;
        host.shutdown().await;
    }

    #[tokio::test]
    async fn three_wrong_codes_close_the_window() {
        let (host, _, _) = node("PC", true).await;
        let (client, _, _) = node("Portable", false).await;
        client.add_addr(host.addr());
        let host_id = host.id().to_string();
        let code = host.open_pairing().unwrap();
        let wrong = if code.code == "000000" { "111111" } else { "000000" };
        for _ in 0..3 {
            assert!(client.pair(&host_id, wrong).await.is_err());
        }
        assert!(host.pairing().is_none());
        assert!(client.pair(&host_id, &code.code).await.is_err(), "the right code no longer works");
        client.shutdown().await;
        host.shutdown().await;
    }

    #[tokio::test]
    async fn a_node_that_does_not_host_refuses_everything() {
        let (host, _, _) = node("PC", false).await;
        let (client, _, _) = node("Portable", false).await;
        client.add_addr(host.addr());
        assert!(host.open_pairing().is_err());
        assert!(client.pair(&host.id().to_string(), "123456").await.is_err());
        client.shutdown().await;
        host.shutdown().await;
    }

    #[tokio::test]
    async fn hosting_node_prefers_fixed_port_and_falls_back_when_busy() {
        let start_fixed = || async {
            let backend = Arc::new(Mock::default());
            let (events, _) = broadcast::channel(16);
            let config = NodeConfig {
                secret: SecretKey::generate(),
                name: "Host".into(),
                hosting: true,
                mdns: false,
                fixed_port: true,
                internet: false,
            };
            Node::start(config, backend, events).await.unwrap()
        };
        let first = start_fixed().await;
        let second = start_fixed().await;
        let first_port = first.port().expect("first host bound a port");
        let second_port = second.port().expect("second host bound a port");
        // If DEFAULT_HOST_PORT was free, the first took it and the second fell back cleanly to another port.
        assert_ne!(first_port, second_port);
        second.shutdown().await;
        first.shutdown().await;
    }
}
