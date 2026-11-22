//! Antigravity (`agy`) adapter: one long-lived `agy -p "" --input-format stream-json` process per chat.
//! Turns are `{"event":"user","message":{...}}` lines. Antigravity has no host permission protocol in print
//! mode: its own `--mode` decides (approvals are not interactive in Neuron). Stop = kill, the next message
//! resumes the conversation with `--conversation <id>`.

pub mod parser;

use serde_json::json;

use crate::agents::events::AgentKind;
use crate::agents::process::{Delivery, spawn_stream_session};
use crate::agents::{AgentAdapter, SessionCommand, SessionHandle, SessionSpec};
use crate::error::AppResult;

use parser::AntigravityParser;

/// Reasoning levels accepted by `agy --effort`.
pub const EFFORT_LEVELS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

pub struct AntigravityAdapter {
    pub binary: String,
}

impl Default for AntigravityAdapter {
    fn default() -> Self {
        Self { binary: std::env::var("NEURON_AGY_BIN").unwrap_or_else(|_| "agy".into()) }
    }
}

pub fn build_args(spec: &SessionSpec) -> Vec<String> {
    let mut args: Vec<String> = ["--input-format", "stream-json", "--output-format", "stream-json"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    match spec.permission_mode.as_str() {
        "acceptEdits" => args.extend(["--mode".into(), "accept-edits".into()]),
        "auto" => args.extend(["--mode".into(), "auto".into()]),
        "plan" => args.extend(["--mode".into(), "plan".into()]),
        "bypassPermissions" => args.push("--dangerously-skip-permissions".into()),
        _ => {} // manual → agy default ("request-review")
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
    // `-p` takes a value: give it an empty one so stdin drives the turns. Must stay last.
    args.extend(["-p".into(), String::new()]);
    args
}

fn encode(command: &SessionCommand) -> Delivery {
    match command {
        SessionCommand::Prompt(text) => Delivery::Line(json!({
            "event": "user",
            "message": { "role": "user", "content": text },
        })),
        SessionCommand::Interrupt => Delivery::Kill,
        SessionCommand::Permission(_) | SessionCommand::Shutdown => Delivery::Ignore,
    }
}

impl AgentAdapter for AntigravityAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Antigravity
    }

    fn start(&self, spec: &SessionSpec) -> AppResult<SessionHandle> {
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
}
