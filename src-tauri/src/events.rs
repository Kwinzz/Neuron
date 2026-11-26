//! Event delivery abstraction so core modules can emit events without depending on Tauri's `AppHandle`.
//!
//! - [`TauriSink`] delivers events to the desktop WebView (preserving window targeting) and forwards shared
//!   channels to paired remote clients via [`crate::remote::hub`].
//! - [`HeadlessSink`] forwards shared channels to paired remote clients only (no desktop UI).

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// Destination for backend events (agent stream, quotas, usage, memory, and local-only remote status).
pub trait EventSink: Send + Sync {
    /// Emit an event to the local frontend (if any) and forward it to connected remote clients.
    fn emit_value(&self, channel: &str, payload: Value);

    /// Emit an event to the local frontend only (never forwarded to paired remote clients).
    /// No-op in headless mode.
    fn emit_local(&self, _channel: &str, _payload: Value) {}
}

/// Serialize `payload` and emit it on `channel` (both locally and to remote clients).
pub fn emit<T: Serialize>(sink: &dyn EventSink, channel: &str, payload: &T) {
    match serde_json::to_value(payload) {
        Ok(value) => sink.emit_value(channel, value),
        Err(err) => tracing::warn!(%err, channel, "event not serializable"),
    }
}

/// Serialize `payload` and emit it locally only (never forwarded to remote clients).
pub fn emit_local<T: Serialize>(sink: &dyn EventSink, channel: &str, payload: &T) {
    match serde_json::to_value(payload) {
        Ok(value) => sink.emit_local(channel, value),
        Err(err) => tracing::warn!(%err, channel, "local event not serializable"),
    }
}

/// Event sink backed by a Tauri [`AppHandle`].
pub struct TauriSink(pub AppHandle);

impl EventSink for TauriSink {
    fn emit_value(&self, channel: &str, payload: Value) {
        let res = if channel == crate::agents::events::AGENT_EVENT_CHANNEL {
            // Main window only: it is the single consumer (`useAgentEventBridge`). Broadcasting also ran every
            // token through the hidden quick-prompt webview — one script evaluation per event, costly in WebKitGTK.
            self.0.emit_to("main", channel, &payload)
        } else {
            self.0.emit(channel, &payload)
        };
        if let Err(err) = res {
            tracing::warn!(%err, channel, "emit failed");
        }
        crate::remote::hub::forward(channel, &payload);
    }

    fn emit_local(&self, channel: &str, payload: Value) {
        if let Err(err) = self.0.emit_to("main", channel, payload) {
            tracing::warn!(%err, channel, "local emit failed");
        }
    }
}

/// Event sink for headless processes: forwards shared events to remote clients only.
pub struct HeadlessSink;

impl EventSink for HeadlessSink {
    fn emit_value(&self, channel: &str, payload: Value) {
        crate::remote::hub::forward(channel, &payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headless_forwards_shared_and_skips_local() {
        let mut rx = crate::remote::hub::sender().subscribe();
        let sink = HeadlessSink;

        emit_local(&sink, crate::remote::REMOTE_STATUS_CHANNEL, &());
        assert!(rx.try_recv().is_err());

        emit(&sink, crate::usage_import::USAGE_CHANGED_EVENT, &serde_json::json!({ "ok": true }));
        let ev = rx.try_recv().unwrap();
        assert_eq!(ev.channel, crate::usage_import::USAGE_CHANGED_EVENT);
        assert_eq!(ev.payload, serde_json::json!({ "ok": true }));
    }
}
