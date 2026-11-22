//! Normalized agent events emitted to the frontend on [`AGENT_EVENT_CHANNEL`].
//!
//! Every adapter (Claude Code stream-json, Antigravity, Codex, generic PTY) translates its native
//! output into these events, so the UI only ever deals with one protocol.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Single Tauri event channel carrying every [`AgentEventEnvelope`].
pub const AGENT_EVENT_CHANNEL: &str = "agent://event";

/// Supported agent families.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AgentKind {
    ClaudeCode,
    Antigravity,
    Codex,
    Generic,
}

/// Granular, live status of a thread (drives the Live Dock).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ThreadStatus {
    Idle,
    Starting,
    Thinking,
    Reading,
    Editing,
    Running,
    AwaitingApproval,
    Done,
    Error,
    Cancelled,
}

impl ThreadStatus {
    /// Database / wire representation.
    pub fn as_str(self) -> &'static str {
        match self {
            ThreadStatus::Idle => "idle",
            ThreadStatus::Starting => "starting",
            ThreadStatus::Thinking => "thinking",
            ThreadStatus::Reading => "reading",
            ThreadStatus::Editing => "editing",
            ThreadStatus::Running => "running",
            ThreadStatus::AwaitingApproval => "awaiting_approval",
            ThreadStatus::Done => "done",
            ThreadStatus::Error => "error",
            ThreadStatus::Cancelled => "cancelled",
        }
    }

    /// True while the agent process is doing work.
    pub fn is_active(self) -> bool {
        !matches!(
            self,
            ThreadStatus::Idle | ThreadStatus::Done | ThreadStatus::Error | ThreadStatus::Cancelled
        )
    }
}

/// Which stream a text delta belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DeltaChannel {
    Text,
    Thinking,
}

/// Token counters. Serialized as plain JSON numbers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TokenUsage {
    #[ts(type = "number")]
    pub input: u64,
    #[ts(type = "number")]
    pub output: u64,
    #[ts(type = "number")]
    pub cache_read: u64,
    #[ts(type = "number")]
    pub cache_write: u64,
    pub cost_usd: f64,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }

    pub fn add(&mut self, other: &TokenUsage) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
        self.cost_usd += other.cost_usd;
    }
}

/// Normalized event produced by any agent adapter.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum AgentEvent {
    /// Incremental assistant text (or thinking) for a message.
    MessageDelta {
        message_id: String,
        channel: DeltaChannel,
        text: String,
    },
    /// A tool invocation started. `activity` is a short human label ("Édition de app.tsx").
    ToolCallStart {
        tool_call_id: String,
        name: String,
        input: serde_json::Value,
        activity: Option<String>,
    },
    /// A tool invocation finished.
    ToolCallResult {
        tool_call_id: String,
        output: String,
        is_error: bool,
    },
    /// The agent asks for approval before running a tool.
    PermissionRequest {
        request_id: String,
        tool_name: String,
        description: String,
        input: serde_json::Value,
    },
    /// Usage of the latest turn plus the running total for the thread.
    TokenUsageUpdate {
        delta: TokenUsage,
        cumulative: TokenUsage,
    },
    /// Status transition; `detail` refines it (e.g. file name being edited).
    ThreadStatusChanged {
        status: ThreadStatus,
        detail: Option<String>,
    },
    /// Error reported by the adapter or the process. `fatal` ends the thread.
    ThreadError { message: String, fatal: bool },
}

/// Payload emitted on [`AGENT_EVENT_CHANNEL`].
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AgentEventEnvelope {
    pub thread_id: String,
    /// Unix milliseconds.
    #[ts(type = "number")]
    pub ts: i64,
    pub event: AgentEvent,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_wire_format_is_tagged_and_camel_case() {
        let env = AgentEventEnvelope {
            thread_id: "t1".into(),
            ts: 42,
            event: AgentEvent::ThreadStatusChanged {
                status: ThreadStatus::AwaitingApproval,
                detail: Some("Bash".into()),
            },
        };
        let json = serde_json::to_value(&env).unwrap();
        assert_eq!(json["threadId"], "t1");
        assert_eq!(json["event"]["kind"], "ThreadStatusChanged");
        assert_eq!(json["event"]["status"], "awaiting_approval");

        let delta = serde_json::to_value(AgentEvent::MessageDelta {
            message_id: "m".into(),
            channel: DeltaChannel::Text,
            text: "hi".into(),
        })
        .unwrap();
        assert_eq!(delta["messageId"], "m");
    }

    #[test]
    fn status_string_matches_serde() {
        for s in [ThreadStatus::AwaitingApproval, ThreadStatus::Editing, ThreadStatus::Done] {
            assert_eq!(serde_json::to_value(s).unwrap(), s.as_str());
        }
    }
}
