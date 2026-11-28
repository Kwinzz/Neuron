//! Antigravity (`agy`) adapter: one long-lived `agy -p "" --input-format stream-json` process per chat.
//! Turns are `{"event":"user","message":{...}}` lines. Antigravity has no host permission protocol in print
//! mode: its own `--mode` decides (approvals are not interactive in Neuron). Stop = kill, the next message
//! resumes the conversation with `--conversation <id>`.

pub mod parser;
pub mod quota;

use std::path::Path;

use serde_json::json;

use crate::agents::events::AgentKind;
use crate::agents::process::{Delivery, spawn_stream_session};
use crate::agents::{AgentAdapter, SessionCommand, SessionHandle, SessionSpec};
use crate::error::AppResult;
use crate::remote::mcp::RemoteMcpLaunch;

use parser::AntigravityParser;

/// Reasoning levels accepted by `agy --effort`.
pub const EFFORT_LEVELS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

/// Workspace plugin directory (`<cwd>/.agents/plugins/neuron`) combined with server key `"remote"`
/// yields Antigravity's namespaced MCP server identifier `neuron_remote`.
const REMOTE_PLUGIN_DIR: &str = "neuron";
const REMOTE_SERVER_KEY: &str = "remote";

const REMOTE_RULES_MD: &str = "# Remote Workspace Mode\n\n\
This chat operates on a **remote device** through the `neuron_remote` MCP server.\n\
Your local working directory is an isolated empty scratch folder on the AI host.\n\n\
- ALWAYS use the `neuron_remote` MCP tools (`remote_read`, `remote_write`, `remote_edit`, `remote_search`, `remote_run`) \
to inspect files, search code, edit files, and run commands on the target device.\n\
- NEVER use local shell or file-editing tools (`run_command`, `write_file`, `edit_file`, `replace_file_content`, \
`multi_replace_file_content`, `list_dir`, `find_by_name`, `grep_search`) for project work.\n\
- Only use `read_file` when Antigravity needs to read a lazy MCP tool schema file under `.gemini/antigravity-cli/mcp/neuron_remote/`.\n";

pub struct AntigravityAdapter {
    pub binary: String,
}

impl Default for AntigravityAdapter {
    fn default() -> Self {
        Self { binary: quota::binary() }
    }
}

/// Stages a per-thread Antigravity workspace plugin exposing `neuron_remote` inside the scratch folder.
pub fn stage_remote_plugin(scratch_cwd: &Path, remote_mcp: &RemoteMcpLaunch) -> AppResult<()> {
    let plugin_dir = scratch_cwd.join(".agents").join("plugins").join(REMOTE_PLUGIN_DIR);
    let rules_dir = plugin_dir.join("rules");
    std::fs::create_dir_all(&rules_dir)?;
    std::fs::write(plugin_dir.join("plugin.json"), serde_json::to_vec_pretty(&json!({ "name": REMOTE_PLUGIN_DIR }))?)?;
    let mcp_config = json!({
        "mcpServers": {
            REMOTE_SERVER_KEY: {
                "command": remote_mcp.command.display().to_string(),
                "args": remote_mcp.args,
            }
        }
    });
    std::fs::write(plugin_dir.join("mcp_config.json"), serde_json::to_vec_pretty(&mcp_config)?)?;
    std::fs::write(rules_dir.join("AGENTS.md"), REMOTE_RULES_MD)?;
    Ok(())
}

pub fn build_args(spec: &SessionSpec) -> Vec<String> {
    let mut args: Vec<String> =
        ["--input-format", "stream-json", "--output-format", "stream-json"].iter().map(|s| s.to_string()).collect();
    if spec.remote_mcp.is_some() {
        // Cross-device: keep headless `request-review` (or `plan`) so local shell/write tools on the AI host
        // stay auto-denied while `neuron_remote` tools are explicitly pre-approved via `--settings`.
        if spec.permission_mode == "plan" {
            args.extend(["--mode".into(), "plan".into()]);
        }
    } else {
        match spec.permission_mode.as_str() {
            "acceptEdits" => args.extend(["--mode".into(), "accept-edits".into()]),
            "auto" => args.extend(["--mode".into(), "auto".into()]),
            "plan" => args.extend(["--mode".into(), "plan".into()]),
            "bypassPermissions" => args.push("--dangerously-skip-permissions".into()),
            _ => {} // manual → agy default ("request-review")
        }
    }
    if let Some(model) = spec.model.as_deref().filter(|m| !m.trim().is_empty()) {
        args.extend(["--model".into(), model.trim().into()]);
    }
    if let Some(effort) = spec.effort.as_deref().filter(|e| EFFORT_LEVELS.contains(e)) {
        args.extend(["--effort".into(), effort.into()]);
    }
    if let Some(conv) = spec.resume.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["--conversation".into(), conv.into()]);
    }
    let mut allow: Vec<String> = Vec::new();
    if let Some(mcp) = &spec.mcp {
        use crate::memory::mcp::{SERVER_NAME, TOOL_NAMES};
        // agy has no per-session CLI flag for global MCP servers: the memory server is registered once
        // (`agy mcp add`), and here we pre-approve its tools for this session.
        let _ = &mcp.command;
        allow.extend(TOOL_NAMES.iter().map(|t| format!("mcp({SERVER_NAME}/{t})")));
    }
    if spec.remote_mcp.is_some() {
        use crate::remote::mcp::{ALL_TOOLS, READ_ONLY_TOOLS, SERVER_NAME};
        // Headless `agy` auto-denies MCP tools that lack an explicit allow rule.
        let tools: &[&str] = if spec.permission_mode == "plan" { &READ_ONLY_TOOLS } else { &ALL_TOOLS };
        allow.extend(tools.iter().map(|t| format!("mcp({SERVER_NAME}/{t})")));
    }
    if !allow.is_empty() {
        let settings = json!({ "permissions": { "allow": allow } });
        args.extend(["--settings".into(), settings.to_string()]);
    }
    // `-p` takes a value: give it an empty one so stdin drives the turns. Must stay last.
    args.extend(["-p".into(), String::new()]);
    args
}

fn encode(command: &SessionCommand) -> Delivery {
    match command {
        // agy only accepts text blocks: attachments (images included) are given as paths it opens itself.
        SessionCommand::Prompt(turn) => Delivery::Line(json!({
            "event": "user",
            "message": { "role": "user", "content": turn.text_with_note(|_| false) },
        })),
        SessionCommand::Interrupt => Delivery::Kill,
        SessionCommand::Permission(_) | SessionCommand::SetMode(_) | SessionCommand::Shutdown => Delivery::Ignore,
    }
}

impl AgentAdapter for AntigravityAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Antigravity
    }

    fn start(&self, spec: &SessionSpec) -> AppResult<SessionHandle> {
        if let Some(remote_mcp) = &spec.remote_mcp {
            stage_remote_plugin(&spec.cwd, remote_mcp)?;
        }
        let mut parser = AntigravityParser::new(uuid::Uuid::new_v4().simple().to_string());
        spawn_stream_session(&self.binary, &build_args(spec), &spec.cwd, spec.thread_id.clone(), encode, move |line| {
            parser.feed(line)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn args_map_settings() {
        let spec = SessionSpec {
            thread_id: "t".into(),
            cwd: PathBuf::from("."),
            model: Some("gemini-4-neon-high".into()),
            effort: Some("max".into()),
            permission_mode: "acceptEdits".into(),
            resume: Some("conv-1".into()),
            append_system_prompt: None,
            mcp: None,
            remote_mcp: None,
            generic: None,
        };
        let args = build_args(&spec);
        let joined = args.join(" ");
        assert!(joined.starts_with("--input-format stream-json --output-format stream-json"));
        assert!(joined.contains("--mode accept-edits"));
        assert!(joined.contains("--model gemini-4-neon-high"));
        assert!(joined.contains("--effort max"));
        assert!(joined.contains("--conversation conv-1"));
        assert_eq!(&args[args.len() - 2..], ["-p".to_string(), String::new()]);
        assert!(matches!(encode(&SessionCommand::Interrupt), Delivery::Kill));
    }

    #[test]
    fn remote_mcp_preapproves_tools_and_stages_plugin() {
        let remote = RemoteMcpLaunch::new(PathBuf::from("/bin/neuron"), Path::new("/data"), "t-42");
        let spec = SessionSpec {
            thread_id: "t-42".into(),
            cwd: PathBuf::from("."),
            model: None,
            effort: None,
            permission_mode: "bypassPermissions".into(),
            resume: None,
            append_system_prompt: None,
            mcp: None,
            remote_mcp: Some(remote.clone()),
            generic: None,
        };
        let args = build_args(&spec);
        let joined = args.join(" ");
        // Never bypass permissions on the AI host in cross-device mode.
        assert!(!joined.contains("--dangerously-skip-permissions"));
        assert!(joined.contains("mcp(neuron_remote/remote_read)"));
        assert!(joined.contains("mcp(neuron_remote/remote_run)"));

        let mut plan_spec = spec;
        plan_spec.permission_mode = "plan".into();
        let plan_joined = build_args(&plan_spec).join(" ");
        assert!(plan_joined.contains("--mode plan"));
        assert!(plan_joined.contains("mcp(neuron_remote/remote_read)"));
        assert!(!plan_joined.contains("mcp(neuron_remote/remote_run)"));

        let tmp = std::env::temp_dir().join(format!("neuron-agy-plugin-{}", uuid::Uuid::new_v4()));
        stage_remote_plugin(&tmp, &remote).unwrap();
        let cfg: serde_json::Value =
            serde_json::from_slice(&std::fs::read(tmp.join(".agents/plugins/neuron/mcp_config.json")).unwrap())
                .unwrap();
        assert_eq!(cfg["mcpServers"]["remote"]["command"], "/bin/neuron");
        assert!(tmp.join(".agents/plugins/neuron/plugin.json").is_file());
        assert!(tmp.join(".agents/plugins/neuron/rules/AGENTS.md").is_file());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
