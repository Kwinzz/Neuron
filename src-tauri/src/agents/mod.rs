//! Multi-agent engine.
//!
//! - [`AgentAdapter`]: starts an agent CLI as a long-lived session for one thread.
//! - Adapters translate their native output into [`AdapterEvent`]s (internal, richer than the UI events).
//! - [`registry::AgentRegistry`] owns running sessions and runs one *pump* task per thread that persists
//!   adapter events to SQLite and emits normalized [`events::AgentEvent`]s to the frontend.

pub mod activity;
pub mod antigravity;
pub mod catalog;
pub mod claude;
pub mod codex;
pub mod events;
pub mod file_changes;
pub mod generic;
pub mod process;
pub mod registry;
pub mod slash;
pub mod summary;

use std::path::PathBuf;

use serde_json::Value;
use tokio::sync::mpsc;

use crate::agents::events::{AgentKind, DeltaChannel, ThreadStatus, TokenUsage};
use crate::error::AppResult;

/// Everything needed to start (or resume) a session for a thread.
#[derive(Debug, Clone)]
pub struct SessionSpec {
    pub thread_id: String,
    pub cwd: PathBuf,
    pub model: Option<String>,
    /// Reasoning effort (agent-specific levels; None = CLI default).
    pub effort: Option<String>,
    pub permission_mode: String,
    /// Agent-native session id to resume (e.g. Claude Code `session_id`).
    pub resume: Option<String>,
    /// Extra context appended to the agent's system prompt (Phase 3: project context + memory).
    pub append_system_prompt: Option<String>,
    /// Neuron's memory MCP server, offered to the agent for this session (Phase 4).
    pub mcp: Option<crate::memory::mcp::McpLaunch>,
    /// Generic CLI to run (AgentKind::Generic), resolved from Paramètres by the chat's model id.
    pub generic: Option<crate::app_settings::GenericCliProfile>,
}

/// A user message: text plus attached files (Neuron's copies, see `attachments`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct UserTurn {
    pub text: String,
    pub attachments: Vec<crate::attachments::Attachment>,
}

impl From<String> for UserTurn {
    fn from(text: String) -> Self {
        Self { text, attachments: Vec::new() }
    }
}

impl From<&str> for UserTurn {
    fn from(text: &str) -> Self {
        Self { text: text.to_string(), attachments: Vec::new() }
    }
}

impl UserTurn {
    /// The text plus the paths of the attachments the agent does not receive natively.
    pub fn text_with_note(&self, native: impl Fn(&crate::attachments::Attachment) -> bool) -> String {
        let rest: Vec<&crate::attachments::Attachment> = self.attachments.iter().filter(|a| !native(a)).collect();
        format!("{}{}", self.text, crate::attachments::note(&rest))
    }
}

/// Commands sent to a running session.
#[derive(Debug, Clone)]
pub enum SessionCommand {
    /// A new user turn.
    Prompt(UserTurn),
    /// Answer to a pending permission request.
    Permission(PermissionDecision),
    /// Ask the agent to stop the current turn (keeps the session alive when supported).
    Interrupt,
    /// Switch the permission mode of the running session (Claude Code only; others restart instead).
    SetMode(String),
    /// Close stdin and terminate the process.
    Shutdown,
}

#[derive(Debug, Clone)]
pub struct PermissionDecision {
    pub request_id: String,
    pub allow: bool,
    /// Original tool input, echoed back on allow.
    pub input: Value,
    pub message: Option<String>,
    /// On allow: permission mode to switch to (approving a plan: `acceptEdits`, `auto`, `manual`).
    pub mode: Option<String>,
}

/// One usage window reported by the agent's provider (e.g. Claude 5-hour / 7-day limits).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RateLimitWindow {
    pub window: String,
    /// 0–1.
    pub utilization: f64,
    /// Unix ms.
    pub resets_at: Option<i64>,
    /// Quota group when the provider has several (Antigravity: « Gemini Models », « Claude and GPT models »…).
    pub group: Option<String>,
    /// Model names sharing this group's quota.
    pub models: Vec<String>,
}

/// Normalized events produced by adapters, consumed by the registry pump.
#[derive(Debug, Clone, PartialEq)]
pub enum AdapterEvent {
    SessionInit {
        session_ref: String,
        model: Option<String>,
    },
    Status {
        status: ThreadStatus,
        detail: Option<String>,
    },
    TextDelta {
        item_id: String,
        channel: DeltaChannel,
        text: String,
    },
    /// A text/thinking block is complete (full text, for persistence).
    BlockCompleted {
        item_id: String,
        channel: DeltaChannel,
        text: String,
    },
    /// The agent's permission mode changed (plan approved, `EnterPlanMode`, live switch). Neuron's id.
    ModeChanged(String),
    /// Output of a command the CLI ran itself, without the model (Claude Code `/usage`, `/context`…).
    /// `name` is without the leading slash; `text` may be empty.
    CommandOutput {
        item_id: String,
        name: String,
        text: String,
    },
    /// `parent_id`: set for calls made by a sub-agent (id of the call that launched it).
    ToolCallStart {
        id: String,
        name: String,
        input: Value,
        parent_id: Option<String>,
    },
    Subagent {
        tool_call_id: String,
        description: Option<String>,
        subagent_type: Option<String>,
        status: crate::agents::events::SubagentStatus,
        tool_uses: Option<u64>,
        tokens: Option<u64>,
        last_tool: Option<String>,
    },
    ToolCallResult {
        id: String,
        output: String,
        is_error: bool,
    },
    PermissionRequest {
        request_id: String,
        tool_name: String,
        description: String,
        input: Value,
        tool_use_id: Option<String>,
    },
    /// End of a turn with its usage.
    TurnComplete {
        usage: TokenUsage,
        duration_ms: Option<i64>,
        error: Option<String>,
    },
    RateLimits(Vec<RateLimitWindow>),
    /// Recoverable adapter problem (unparseable line, unexpected payload…).
    Warning(String),
    /// The process exited.
    Exited {
        code: Option<i32>,
        stderr_tail: String,
    },
}

/// Handle to a running session.
pub struct SessionHandle {
    pub commands: mpsc::UnboundedSender<SessionCommand>,
    pub events: mpsc::UnboundedReceiver<AdapterEvent>,
    /// OS process id, for forced termination of the whole process tree.
    pub pid: Option<u32>,
}

/// A CLI agent integration.
pub trait AgentAdapter: Send + Sync {
    fn kind(&self) -> AgentKind;
    /// The CLI accepts extra system instructions (`SessionSpec::append_system_prompt`). Otherwise the project
    /// context is sent as a preamble of the first message.
    fn supports_system_prompt(&self) -> bool {
        false
    }
    /// Spawn the agent process for `spec`. Must not block: I/O runs on background tasks.
    fn start(&self, spec: &SessionSpec) -> AppResult<SessionHandle>;
}

/// Kill a process and all its children (agents spawn shells, servers, …).
pub fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill").args(["-TERM", &format!("-{pid}")]).status();
        let _ = std::process::Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
}
