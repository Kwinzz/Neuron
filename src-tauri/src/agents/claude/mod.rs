//! Claude Code adapter: one long-lived `claude -p` process per thread, bidirectional stream-json.
//!
//! - stdin: `{"type":"user",...}` turns, `control_response` for permissions, `control_request` interrupt.
//! - stdout: parsed by [`parser::ClaudeParser`].
//! - Permissions are delegated to Neuron with `--permission-prompts host --permission-prompt-tool stdio`.

pub mod parser;

use serde_json::{Value, json};

use crate::agents::events::AgentKind;
use crate::agents::process::{Delivery, spawn_stream_session};
use crate::agents::{AgentAdapter, SessionCommand, SessionHandle, SessionSpec};
use crate::error::AppResult;

use parser::ClaudeParser;

/// Reasoning effort levels accepted by `claude --effort`.
pub const EFFORT_LEVELS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

pub struct ClaudeCodeAdapter {
    /// Executable name or path (default `claude`, resolved through PATH).
    pub binary: String,
}

impl Default for ClaudeCodeAdapter {
    fn default() -> Self {
        Self { binary: std::env::var("NEURON_CLAUDE_BIN").unwrap_or_else(|_| "claude".into()) }
    }
}

/// Builds the CLI arguments for a session (pure, unit-tested).
pub fn build_args(spec: &SessionSpec) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompts",
        "host",
        "--permission-prompt-tool",
        "stdio",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let mode = match spec.permission_mode.as_str() {
        m @ ("manual" | "acceptEdits" | "auto" | "plan" | "bypassPermissions" | "dontAsk") => m,
        _ => "manual",
    };
    // Only makes « Tout autoriser » available: without it, switching a chat to it live (`set_permission_mode`) is
    // refused (`bypass_not_launched`) and the session kept asking for approvals. The mode itself stays the above.
    args.extend(["--permission-mode".into(), mode.into(), "--allow-dangerously-skip-permissions".into()]);
    if let Some(model) = spec.model.as_deref().filter(|m| !m.trim().is_empty()) {
        args.extend(["--model".into(), model.trim().into()]);
    }
    if let Some(effort) = spec.effort.as_deref().filter(|e| EFFORT_LEVELS.contains(e)) {
        args.extend(["--effort".into(), effort.into()]);
    }
    if let Some(session) = spec.resume.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["--resume".into(), session.into()]);
    }
    if let Some(extra) = spec.append_system_prompt.as_deref().filter(|s| !s.trim().is_empty()) {
        args.extend(["--append-system-prompt".into(), extra.into()]);
    }
    let mut mcp_servers = serde_json::Map::new();
    let mut allowed: Vec<String> = Vec::new();
    if let Some(mcp) = &spec.mcp {
        use crate::memory::mcp::{SERVER_NAME, TOOL_NAMES};
        mcp_servers.insert(
            SERVER_NAME.into(),
            json!({
                "type": "stdio",
                "command": mcp.command.display().to_string(),
                "args": mcp.args,
            }),
        );
        allowed.extend(TOOL_NAMES.iter().map(|t| format!("mcp__{SERVER_NAME}__{t}")));
    }
    if let Some(remote_mcp) = &spec.remote_mcp {
        use crate::remote::mcp::{ALL_TOOLS, EDIT_TOOLS, READ_ONLY_TOOLS, SERVER_NAME};
        mcp_servers.insert(
            SERVER_NAME.into(),
            json!({
                "type": "stdio",
                "command": remote_mcp.command.display().to_string(),
                "args": remote_mcp.args,
            }),
        );
        // Disable local disk & shell tools so Claude acts exclusively on the target device via MCP.
        args.push("--disallowedTools=Bash,Read,Edit,Write,Glob,Grep,NotebookEdit,LS".into());
        match mode {
            "plan" | "manual" => {
                allowed.extend(READ_ONLY_TOOLS.iter().map(|t| format!("mcp__{SERVER_NAME}__{t}")));
            }
            "acceptEdits" => {
                allowed.extend(
                    READ_ONLY_TOOLS.iter().chain(EDIT_TOOLS.iter()).map(|t| format!("mcp__{SERVER_NAME}__{t}")),
                );
            }
            _ => {
                allowed.extend(ALL_TOOLS.iter().map(|t| format!("mcp__{SERVER_NAME}__{t}")));
            }
        }
    }
    if !mcp_servers.is_empty() {
        let config = json!({ "mcpServers": mcp_servers });
        // `=` forms: both options are variadic and must not swallow the next argument.
        args.push(format!("--mcp-config={config}"));
    }
    if !allowed.is_empty() {
        args.push(format!("--allowedTools={}", allowed.join(",")));
    }
    args
}

/// JSON line written to stdin for a command, or `None` for commands handled otherwise.
pub fn encode_command(command: &SessionCommand) -> Option<Value> {
    match command {
        SessionCommand::Prompt(turn) => {
            let inline: Vec<(&crate::attachments::Attachment, String)> = turn
                .attachments
                .iter()
                .filter_map(|a| crate::attachments::inline_base64(a).map(|data| (a, data)))
                .collect();
            let text = turn.text_with_note(|a| inline.iter().any(|(i, _)| i.id == a.id));
            let content = if inline.is_empty() {
                json!(text)
            } else {
                let mut blocks = vec![json!({ "type": "text", "text": text })];
                blocks.extend(inline.iter().map(|(a, data)| {
                    json!({ "type": "image", "source": { "type": "base64", "media_type": a.mime, "data": data } })
                }));
                json!(blocks)
            };
            Some(json!({ "type": "user", "message": { "role": "user", "content": content } }))
        }
        SessionCommand::Permission(d) => {
            let response = if d.allow {
                let mut allow = json!({ "behavior": "allow", "updatedInput": d.input });
                // Approving a plan (ExitPlanMode) also chooses how to run it, like Claude Code's own prompt.
                if let Some(mode) = d.mode.as_deref() {
                    allow["updatedPermissions"] =
                        json!([{ "type": "setMode", "mode": claude_mode(mode), "destination": "session" }]);
                }
                allow
            } else {
                json!({
                    "behavior": "deny",
                    "message": d.message.clone().unwrap_or_else(|| crate::tr!("Refusé par l'utilisateur dans Neuron.", "Denied by the user in Neuron.")),
                })
            };
            Some(json!({
                "type": "control_response",
                "response": { "subtype": "success", "request_id": d.request_id, "response": response },
            }))
        }
        SessionCommand::SetMode(mode) => Some(json!({
            "type": "control_request",
            "request_id": uuid::Uuid::new_v4().to_string(),
            "request": { "subtype": "set_permission_mode", "mode": claude_mode(mode) },
        })),
        SessionCommand::Interrupt => Some(json!({
            "type": "control_request",
            "request_id": uuid::Uuid::new_v4().to_string(),
            "request": { "subtype": "interrupt" },
        })),
        SessionCommand::Shutdown => None,
    }
}

impl AgentAdapter for ClaudeCodeAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::ClaudeCode
    }

    fn supports_system_prompt(&self) -> bool {
        true
    }

    fn start(&self, spec: &SessionSpec) -> AppResult<SessionHandle> {
        let mut parser = ClaudeParser::new();
        spawn_stream_session(
            &self.binary,
            &build_args(spec),
            &spec.cwd,
            spec.thread_id.clone(),
            |command| encode_command(command).map_or(Delivery::Ignore, Delivery::Line),
            move |line| parser.feed(line),
        )
    }
}

/// Neuron mode id -> Claude Code's (`manual` is reported back as `default`).
fn claude_mode(mode: &str) -> &str {
    match mode {
        "manual" => "default",
        m @ ("acceptEdits" | "auto" | "plan" | "bypassPermissions" | "dontAsk") => m,
        _ => "default",
    }
}

/// Claude Code mode -> Neuron's.
pub fn neuron_mode(mode: &str) -> &str {
    match mode {
        "default" | "manual" => "manual",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::PermissionDecision;
    use std::path::PathBuf;

    fn spec() -> SessionSpec {
        SessionSpec {
            thread_id: "t".into(),
            cwd: PathBuf::from("."),
            model: Some("sonnet".into()),
            effort: Some("xhigh".into()),
            permission_mode: "acceptEdits".into(),
            resume: Some("abc".into()),
            append_system_prompt: None,
            mcp: None,
            remote_mcp: None,
            generic: None,
        }
    }

    #[test]
    fn args_include_protocol_flags() {
        let args = build_args(&spec());
        let joined = args.join(" ");
        assert!(joined.contains("--input-format stream-json --output-format stream-json --verbose"));
        assert!(joined.contains("--permission-prompt-tool stdio"));
        assert!(joined.contains("--permission-mode acceptEdits"));
        assert!(joined.contains("--model sonnet"));
        assert!(joined.contains("--resume abc"));
        assert!(joined.contains("--effort xhigh"));
        let mut bad = spec();
        bad.effort = Some("ultra; rm".into());
        assert!(!build_args(&bad).contains(&"--effort".to_string()));
        // Always there, so a chat started in another mode can switch to bypass live.
        assert!(joined.contains("--allow-dangerously-skip-permissions"));
        assert!(!joined.contains("--permission-mode bypassPermissions"));
        let mut weird = spec();
        weird.permission_mode = "rm -rf".into();
        assert!(build_args(&weird).join(" ").contains("--permission-mode manual"));
    }

    #[test]
    fn encodes_commands() {
        let prompt = encode_command(&SessionCommand::Prompt("salut".into())).unwrap();
        assert_eq!(prompt["message"]["content"], "salut");

        let allow = encode_command(&SessionCommand::Permission(PermissionDecision {
            request_id: "r1".into(),
            allow: true,
            input: json!({"file_path": "a"}),
            message: None,
            mode: None,
        }))
        .unwrap();
        assert_eq!(allow["response"]["request_id"], "r1");
        assert_eq!(allow["response"]["response"]["behavior"], "allow");
        assert_eq!(allow["response"]["response"]["updatedInput"]["file_path"], "a");

        let deny = encode_command(&SessionCommand::Permission(PermissionDecision {
            request_id: "r2".into(),
            allow: false,
            input: Value::Null,
            message: None,
            mode: None,
        }))
        .unwrap();
        assert_eq!(deny["response"]["response"]["behavior"], "deny");
        let plan = encode_command(&SessionCommand::Permission(PermissionDecision {
            request_id: "r3".into(),
            allow: true,
            input: json!({"plan": "1. x"}),
            message: None,
            mode: Some("acceptEdits".into()),
        }))
        .unwrap();
        assert_eq!(plan["response"]["response"]["updatedPermissions"][0]["mode"], "acceptEdits");
        let switch = encode_command(&SessionCommand::SetMode("manual".into())).unwrap();
        assert_eq!(switch["request"]["subtype"], "set_permission_mode");
        assert_eq!(switch["request"]["mode"], "default");

        assert_eq!(encode_command(&SessionCommand::Interrupt).unwrap()["request"]["subtype"], "interrupt");
        assert!(encode_command(&SessionCommand::Shutdown).is_none());
    }

    #[test]
    fn remote_mcp_disables_local_tools_and_maps_permissions() {
        let mut s = spec();
        s.remote_mcp = Some(crate::remote::mcp::RemoteMcpLaunch::new(
            PathBuf::from("neuron"),
            std::path::Path::new("/data"),
            "th-1",
        ));

        s.permission_mode = "manual".into();
        let manual = build_args(&s).join(" ");
        assert!(manual.contains("--disallowedTools=Bash,Read,Edit,Write,Glob,Grep,NotebookEdit,LS"));
        assert!(manual.contains("mcp__neuron_remote__remote_read"));
        assert!(!manual.contains("mcp__neuron_remote__remote_edit"));
        assert!(!manual.contains("mcp__neuron_remote__remote_run"));

        s.permission_mode = "acceptEdits".into();
        let edits = build_args(&s).join(" ");
        assert!(edits.contains("mcp__neuron_remote__remote_edit"));
        assert!(edits.contains("mcp__neuron_remote__remote_write"));
        assert!(!edits.contains("mcp__neuron_remote__remote_run"));

        s.permission_mode = "bypassPermissions".into();
        let bypass = build_args(&s).join(" ");
        assert!(bypass.contains("mcp__neuron_remote__remote_run"));
    }
}
