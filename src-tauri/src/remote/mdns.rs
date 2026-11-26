//! Multi-interface mDNS address lookup for iroh (wire-compatible with `iroh-mdns-address-lookup`).
//!
//! Why our own wrapper around `swarm-discovery` instead of `iroh-mdns-address-lookup`?
//! `iroh-mdns-address-lookup` binds `swarm-discovery` on `0.0.0.0` in single-interface mode without exposing
//! `with_multicast_interfaces_v4`. On Windows (and multi-homed hosts) with a virtual adapter like Tailscale,
//! WireGuard, WSL2 or Hyper-V that has a lower interface metric than Ethernet/Wi-Fi, `0.0.0.0` routes all mDNS
//! multicast to the virtual adapter and LAN peers are never seen. Passing every active LAN IPv4 address via
//! `with_multicast_interfaces_v4` (and updating them live through `netwatch::netmon`) joins and announces on
//! every real LAN interface simultaneously.

use std::collections::{BTreeSet, HashMap};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::FutureExt;
use iroh::EndpointId;
use iroh::address_lookup::{
    AddressLookup, EndpointData, EndpointInfo, Error as AddressLookupError, Item as AddressLookupItem,
};
use n0_future::Stream;
use n0_future::boxed::BoxStream;
use n0_future::task::{self, AbortOnDropHandle, JoinSet};
use n0_watcher::{Watchable, Watcher as _};
use netwatch::interfaces::{IpNet, State as InterfaceState};
use netwatch::netmon::Monitor;
use swarm_discovery::{Discoverer, DropGuard, IpClass, Peer};
use tokio::sync::mpsc::{self, error::TrySendError};
use tokio_stream::wrappers::ReceiverStream;

use super::protocol::net_err;
use crate::error::AppResult;

const PROVENANCE: &str = "mdns";
const USER_DATA_ATTRIBUTE: &str = "user-data";
const RELAY_URL_ATTRIBUTE: &str = "relay";
const CADENCE: Duration = Duration::from_millis(700);
const LOOKUP_DURATION: Duration = Duration::from_secs(10);

/// Event emitted by [`MdnsLookup::subscribe`].
#[derive(Debug, Clone, Eq, PartialEq)]
pub enum DiscoveryEvent {
    Discovered { endpoint_info: EndpointInfo },
    Expired { endpoint_id: EndpointId },
}

/// Multi-interface mDNS address lookup backed by `swarm-discovery`.
#[derive(Debug, Clone)]
pub struct MdnsLookup {
    #[allow(dead_code)]
    handle: Arc<AbortOnDropHandle<()>>,
    sender: mpsc::Sender<Message>,
    advertise: bool,
    local_addrs: Watchable<Option<EndpointData>>,
}

#[derive(Debug)]
enum Message {
    Discovered(String, Peer),
    Resolve(EndpointId, mpsc::Sender<Result<AddressLookupItem, AddressLookupError>>),
    Timeout(EndpointId, usize),
    Subscribe(mpsc::Sender<DiscoveryEvent>),
}

struct Subscribers(Vec<mpsc::Sender<DiscoveryEvent>>);

impl Subscribers {
    fn new() -> Self {
        Self(Vec::new())
    }

    fn push(&mut self, subscriber: mpsc::Sender<DiscoveryEvent>) {
        self.0.push(subscriber);
    }

    fn send(&mut self, item: DiscoveryEvent) {
        let mut stale = Vec::new();
        for (i, subscriber) in self.0.iter().enumerate() {
            if let Err(err) = subscriber.try_send(item.clone()) {
                match err {
                    TrySendError::Full(_) => tracing::warn!(idx = i, "remote: mDNS subscriber full, dropping event"),
                    TrySendError::Closed(_) => stale.push(i),
                }
            }
        }
        for i in stale.into_iter().rev() {
            self.0.swap_remove(i);
        }
    }
}

/// Active LAN IPv4 addresses suitable for mDNS multicast.
///
/// Excludes loopback (`127.0.0.0/8`), link-local/APIPA (`169.254.0.0/16`, e.g. disconnected Tailscale/Bluetooth),
/// multicast/broadcast, and RFC 6598 CGNAT (`100.64.0.0/10`, used by active Tailscale tunnels which don't carry LAN
/// multicast).
pub fn lan_ipv4_from_state(state: &InterfaceState) -> BTreeSet<Ipv4Addr> {
    let mut addrs = BTreeSet::new();
    for iface in state.interfaces.values() {
        if !iface.is_up() {
            continue;
        }
        for net in iface.addrs() {
            let IpNet::V4(v4) = net else { continue };
            let ip = v4.addr();
            if is_lan_multicast_v4(ip) {
                addrs.insert(ip);
            }
        }
    }
    addrs
}

fn is_lan_multicast_v4(ip: Ipv4Addr) -> bool {
    if ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
    {
        return false;
    }
    let [a, b, _, _] = ip.octets();
    // 100.64.0.0/10 (RFC 6598): Tailscale / CGNAT tunnels without LAN multicast.
    !(a == 100 && (64..=127).contains(&b))
}

impl MdnsLookup {
    /// Starts mDNS discovery on every active LAN IPv4 interface (plus IPv6) and keeps interfaces synced as the
    /// network changes.
    pub async fn start(endpoint_id: EndpointId, service_name: &str, advertise: bool) -> AppResult<Self> {
        let (monitor, initial_state) = match Monitor::new().await {
            Ok(monitor) => {
                let state = monitor.interface_state().get();
                (Some(monitor), state)
            }
            Err(err) => {
                tracing::debug!(%err, "remote: network monitor unavailable, using interface snapshot");
                (None, InterfaceState::new().await)
            }
        };
        let mut active_ifaces = lan_ipv4_from_state(&initial_state);
        tracing::info!(interfaces = ?active_ifaces, advertise, "remote: starting mDNS");

        let (send, mut recv) = mpsc::channel(64);
        let task_sender = send.clone();
        let rt = tokio::runtime::Handle::current();
        let discoverer = spawn_discoverer(
            endpoint_id,
            service_name,
            task_sender.clone(),
            active_ifaces.iter().copied().collect(),
            &rt,
        )?;

        let local_addrs: Watchable<Option<EndpointData>> = Watchable::default();
        let mut addrs_change = local_addrs.watch();
        let mut iface_watch = monitor.as_ref().map(Monitor::interface_state);

        let actor = async move {
            // Keep the network monitor alive for the lifetime of the mDNS actor.
            let _monitor = monitor;
            let mut endpoint_addrs: HashMap<EndpointId, AddressLookupItem> = HashMap::new();
            let mut subscribers = Subscribers::new();
            let mut last_id = 0usize;
            let mut senders: HashMap<
                EndpointId,
                HashMap<usize, mpsc::Sender<Result<AddressLookupItem, AddressLookupError>>>,
            > = HashMap::new();
            let mut timeouts = JoinSet::new();

            loop {
                let msg = tokio::select! {
                    msg = recv.recv() => msg,
                    Ok(Some(data)) = addrs_change.updated() => {
                        apply_local_data(&discoverer, &data);
                        continue;
                    }
                    Ok(state) = async {
                        match iface_watch.as_mut() {
                            Some(w) => w.updated().await,
                            None => std::future::pending().await,
                        }
                    } => {
                        sync_interfaces(&discoverer, &mut active_ifaces, &state);
                        continue;
                    }
                };
                let Some(msg) = msg else {
                    timeouts.abort_all();
                    discoverer.remove_all();
                    return;
                };
                match msg {
                    Message::Discovered(raw_id, peer_info) => {
                        let Ok(discovered_id) = EndpointId::from_str(&raw_id) else {
                            tracing::debug!(raw_id, "remote: ignoring mDNS peer with invalid endpoint id");
                            continue;
                        };
                        if discovered_id == endpoint_id {
                            continue;
                        }
                        if peer_info.is_expiry() {
                            endpoint_addrs.remove(&discovered_id);
                            subscribers.send(DiscoveryEvent::Expired { endpoint_id: discovered_id });
                            continue;
                        }
                        let item = peer_to_item(&peer_info, &discovered_id);
                        if !cache_item(&mut endpoint_addrs, item.clone()) {
                            continue;
                        }
                        let mut resolved = false;
                        if let Some(peer_senders) = senders.get(&discovered_id) {
                            resolved = true;
                            for s in peer_senders.values() {
                                let _ = s.send(Ok(item.clone())).await;
                            }
                        }
                        if !resolved {
                            subscribers
                                .send(DiscoveryEvent::Discovered { endpoint_info: item.endpoint_info().clone() });
                        }
                    }
                    Message::Resolve(target_id, reply) => {
                        last_id += 1;
                        let req_id = last_id;
                        if let Some(item) = endpoint_addrs.get(&target_id) {
                            let _ = reply.send(Ok(item.clone())).await;
                        }
                        senders.entry(target_id).or_default().insert(req_id, reply);
                        let timeout_sender = task_sender.clone();
                        timeouts.spawn(async move {
                            tokio::time::sleep(LOOKUP_DURATION).await;
                            let _ = timeout_sender.send(Message::Timeout(target_id, req_id)).await;
                        });
                    }
                    Message::Timeout(target_id, req_id) => {
                        if let Some(peer_senders) = senders.get_mut(&target_id) {
                            peer_senders.remove(&req_id);
                            if peer_senders.is_empty() {
                                senders.remove(&target_id);
                            }
                        }
                    }
                    Message::Subscribe(subscriber) => {
                        for item in endpoint_addrs.values() {
                            let _ = subscriber
                                .try_send(DiscoveryEvent::Discovered { endpoint_info: item.endpoint_info().clone() });
                        }
                        subscribers.push(subscriber);
                    }
                }
            }
        };

        let handle = task::spawn(actor);
        Ok(Self { handle: Arc::new(AbortOnDropHandle::new(handle)), sender: send, advertise, local_addrs })
    }

    /// Subscribe to passively discovered (and expired) peers on the local network.
    pub async fn subscribe(&self) -> impl Stream<Item = DiscoveryEvent> + Unpin + use<> {
        let (tx, rx) = mpsc::channel(32);
        let _ = self.sender.send(Message::Subscribe(tx)).await;
        ReceiverStream::new(rx)
    }
}

impl AddressLookup for MdnsLookup {
    fn resolve(&self, endpoint_id: EndpointId) -> Option<BoxStream<Result<AddressLookupItem, AddressLookupError>>> {
        let (tx, rx) = mpsc::channel(20);
        let sender = self.sender.clone();
        let stream = async move {
            let _ = sender.send(Message::Resolve(endpoint_id, tx)).await;
            ReceiverStream::new(rx)
        };
        Some(Box::pin(stream.flatten_stream()))
    }

    fn publish(&self, data: &EndpointData) {
        if self.advertise {
            let _ = self.local_addrs.set(Some(data.clone()));
        }
    }
}

fn spawn_discoverer(
    endpoint_id: EndpointId,
    service_name: &str,
    sender: mpsc::Sender<Message>,
    interfaces_v4: Vec<Ipv4Addr>,
    rt: &tokio::runtime::Handle,
) -> AppResult<DropGuard> {
    let spawn_rt = rt.clone();
    let callback = move |peer_id: &str, peer: &Peer| {
        let sender = sender.clone();
        let peer_id = peer_id.to_string();
        let peer = peer.clone();
        spawn_rt.spawn(async move {
            let _ = sender.send(Message::Discovered(peer_id, peer)).await;
        });
    };
    let peer_id = data_encoding::BASE32_NOPAD.encode(endpoint_id.as_bytes()).to_ascii_lowercase();
    let mut discoverer = Discoverer::new_interactive(service_name.to_string(), peer_id)
        .with_cadence(CADENCE)
        .with_callback(callback)
        .with_ip_class(IpClass::Auto);
    if !interfaces_v4.is_empty() {
        discoverer = discoverer.with_multicast_interfaces_v4(interfaces_v4);
    }
    discoverer.spawn(rt).map_err(net_err)
}

fn apply_local_data(discoverer: &DropGuard, data: &EndpointData) {
    discoverer.remove_all();
    let mut by_port: HashMap<u16, Vec<IpAddr>> = HashMap::new();
    for addr in data.ip_addrs() {
        by_port.entry(addr.port()).or_default().push(addr.ip());
    }
    for (port, ips) in by_port {
        discoverer.add(port, ips);
    }
    if let Some(relay) = data.relay_urls().next()
        && let Err(err) = discoverer.set_txt_attribute(RELAY_URL_ATTRIBUTE.to_string(), Some(relay.to_string()))
    {
        tracing::warn!(%err, "remote: failed to set mDNS relay TXT attribute");
    }
    if let Some(user_data) = data.user_data()
        && let Err(err) = discoverer.set_txt_attribute(USER_DATA_ATTRIBUTE.to_string(), Some(user_data.to_string()))
    {
        tracing::warn!(%err, "remote: failed to set mDNS user-data TXT attribute");
    }
}

fn sync_interfaces(discoverer: &DropGuard, current: &mut BTreeSet<Ipv4Addr>, state: &InterfaceState) {
    let next = lan_ipv4_from_state(state);
    if next == *current {
        return;
    }
    for removed in current.difference(&next) {
        discoverer.remove_interface_v4(*removed);
    }
    for added in next.difference(current) {
        discoverer.add_interface_v4(*added);
    }
    tracing::info!(interfaces = ?next, "remote: updated mDNS interfaces");
    *current = next;
}

fn cache_item(cache: &mut HashMap<EndpointId, AddressLookupItem>, item: AddressLookupItem) -> bool {
    let id = item.endpoint_id();
    let changed = cache.get(&id).is_none_or(|old| old.endpoint_info() != item.endpoint_info());
    cache.insert(id, item);
    changed
}

fn peer_to_item(peer: &Peer, endpoint_id: &EndpointId) -> AddressLookupItem {
    let ip_addrs: BTreeSet<SocketAddr> = peer.addrs().iter().map(|(ip, port)| SocketAddr::new(*ip, *port)).collect();
    let mut data = EndpointData::from(ip_addrs);
    if let Some(Some(relay)) = peer.txt_attribute(RELAY_URL_ATTRIBUTE)
        && let Ok(url) = relay.parse()
    {
        data.add_relay_url(url);
    }
    if let Some(Some(user_data)) = peer.txt_attribute(USER_DATA_ATTRIBUTE)
        && let Ok(parsed) = user_data.parse()
    {
        data.set_user_data(Some(parsed));
    }
    AddressLookupItem::new(EndpointInfo::from_parts(*endpoint_id, data), PROVENANCE, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_out_virtual_and_non_lan_ipv4() {
        // Real private LANs are kept.
        assert!(is_lan_multicast_v4(Ipv4Addr::new(192, 168, 1, 12)));
        assert!(is_lan_multicast_v4(Ipv4Addr::new(10, 0, 0, 5)));
        assert!(is_lan_multicast_v4(Ipv4Addr::new(172, 16, 0, 2)));
        // Loopback, APIPA (disconnected Tailscale / Bluetooth), and Tailscale CGNAT are excluded.
        assert!(!is_lan_multicast_v4(Ipv4Addr::LOCALHOST));
        assert!(!is_lan_multicast_v4(Ipv4Addr::UNSPECIFIED));
        assert!(!is_lan_multicast_v4(Ipv4Addr::new(169, 254, 83, 107)));
        assert!(!is_lan_multicast_v4(Ipv4Addr::new(100, 64, 0, 1)));
        assert!(!is_lan_multicast_v4(Ipv4Addr::new(100, 100, 42, 7)));
        assert!(!is_lan_multicast_v4(Ipv4Addr::new(100, 127, 255, 254)));
        assert!(!is_lan_multicast_v4(Ipv4Addr::new(224, 0, 0, 251)));
    }
}
