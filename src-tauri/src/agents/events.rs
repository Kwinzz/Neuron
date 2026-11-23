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

impl AgentKind {
    pub const ALL: [AgentKind; 4] = [
        AgentKind::ClaudeCode,
        AgentKind::Antigravity,
        AgentKind::Codex,
        AgentKind::Generic,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            AgentKind::ClaudeCode => "claude_code",
            AgentKind::Antigravity => "antigravity",
            AgentKind::Codex => "codex",
            AgentKind::Generic => "generic",
        }
    }

    /// Unknown values map to [`AgentKind::Generic`].
    pub fn parse(value: &str) -> Self {
        Self::ALL
            .into_iter()
            .find(|k| k.as_str() == value)
            .unwrap_or(AgentKind::Generic)
    }
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

    pub const ALL: [ThreadStatus; 10] = [
        ThreadStatus::Idle,
        ThreadStatus::Starting,
        ThreadStatus::Thinking,
        ThreadStatus::Reading,
        ThreadStatus::Editing,
        ThreadStatus::Running,
        ThreadStatus::AwaitingApproval,
        ThreadStatus::Done,
        ThreadStatus::Error,
        ThreadStatus::Cancelled,
    ];

    /// Unknown values map to [`ThreadStatus::Idle`].
    pub fn parse(value: &str) -> Self {
        Self::ALL
            .into_iter()
            .find(|s| s.as_str() == value)
            .unwrap_or(ThreadStatus::Idle)
    }

    /// SQL list of active statuses, for `status IN (...)` filters.
    pub fn active_sql_list() -> String {
        Self::ALL
            .into_iter()
            .filter(|s| s.is_active())
            .map(|s| format!("'{}'", s.as_str()))
            .collect::<Vec<_>>()
            .join(",")
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
    /// A text/thinking item finished streaming (its full text is persisted).
    MessageCompleted { message_id: String },
    /// Output of a slash command run by the CLI itself, without the model (`/usage`, `/context`…).
    CommandOutput { message_id: String, name: String, text: String },
    /// A tool invocation started. `activity` is a short human label ("Édition de app.tsx").
    ToolCallStart {
        tool_call_id: String,
        name: String,
        input: serde_json::Value,
        activity: Option<String>,
        /// Set when a sub-agent made this call: the id of the tool call that launched the sub-agent.
        parent_tool_call_id: Option<String>,
    },
    /// A tool invocation finished.
    ToolCallResult {
        tool_call_id: String,
        output: String,
        is_error: bool,
        /// Files the call modified, with their diff (edit tools only).
        changes: Vec<crate::agents::file_changes::FileChange>,
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
    /// A sub-agent (Claude Code `Agent`/`Task` tool) started, progressed or ended. `toolCallId` is the call
    /// that launched it; its own tool calls carry it as `parentToolCallId`.
    SubagentUpdate {
        tool_call_id: String,
        description: Option<String>,
        subagent_type: Option<String>,
        status: SubagentStatus,
        #[ts(type = "number | null")]
        tool_uses: Option<u64>,
        #[ts(type = "number | null")]
        tokens: Option<u64>,
        last_tool: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SubagentStatus {
    Running,
    Completed,
    Failed,
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

macro_rules! sql_text_enum {
    ($ty:ty) => {
        impl rusqlite::types::FromSql for $ty {
            fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
                value.as_str().map(<$ty>::parse)
            }
        }
        impl rusqlite::types::ToSql for $ty {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }
    };
}
sql_text_enum!(AgentKind);
sql_text_enum!(ThreadStatus);

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
