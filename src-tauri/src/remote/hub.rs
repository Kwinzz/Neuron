//! This device's events (`agent://event`, `memory://changed`, `quotas://changed`, `usage://changed`), copied to the
//! paired clients connected right now. Free when nobody is connected: nothing is even serialized.

use std::sync::OnceLock;

use serde::Serialize;
use tokio::sync::broadcast;

use super::protocol::WireEvent;

/// Events buffered per client before it is told to resync (a streaming answer emits many small events).
const CAPACITY: usize = 4096;

fn hub() -> &'static broadcast::Sender<WireEvent> {
    static HUB: OnceLock<broadcast::Sender<WireEvent>> = OnceLock::new();
    HUB.get_or_init(|| broadcast::channel(CAPACITY).0)
}

/// The bus every hosting node forwards to its clients.
pub fn sender() -> broadcast::Sender<WireEvent> {
    hub().clone()
}

/// Called next to each local `emit`: forwards the event to the connected clients, if any.
pub fn forward<T: Serialize>(channel: &str, payload: &T) {
    let tx = hub();
    if tx.receiver_count() == 0 {
        return;
    }
    match serde_json::to_value(payload) {
        Ok(payload) => {
            let _ = tx.send(WireEvent { channel: channel.to_string(), payload });
        }
        Err(err) => tracing::warn!(%err, channel, "remote: event not serializable"),
    }
}
