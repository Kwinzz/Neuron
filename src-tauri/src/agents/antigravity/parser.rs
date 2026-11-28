//! Pure parser for Antigravity (`agy`) `--output-format stream-json` output.
//!
//! Events: `init` (conversation id, model), `step_update` (user_input | agent_response with `text_delta` |
//! tool with `tool_info`; state ACTIVE → DONE; per-step `usage`), `result` (end of turn; its usage is
//! cumulative over the session, so per-turn usage is summed from the steps instead).
//!
//! Sub-agents: an `invoke_subagent` step (`step_type: subagent`, `subagent_info.subagents[]`: role, type, prompt)
//! launches them and is done as soon as they run; they work on their own until `manage_subagents` kills them
//! (`kill_all`, or the roles it lists) or the turn ends.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::agents::AdapterEvent;
use crate::agents::events::{DeltaChannel, SubagentStatus, ThreadStatus, TokenUsage};

#[derive(Debug)]
pub struct AntigravityParser {
    /// Unique per process: step indexes may restart when a conversation is resumed.
    nonce: String,
    texts: HashMap<u64, String>,
    started_tools: HashSet<u64>,
    finished_tools: HashSet<u64>,
    turn_usage: TokenUsage,
    /// Running sub-agents: (id, role).
    subagents: Vec<(String, Option<String>)>,
}

fn u(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn s_(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|t| !t.trim().is_empty()).map(str::to_string)
}

/// An Antigravity sub-agent's state (fields left `None` keep their previous value in the UI).
fn subagent(id: String, status: SubagentStatus) -> AdapterEvent {
    AdapterEvent::Subagent {
        tool_call_id: id,
        description: None,
        subagent_type: None,
        status,
        tool_uses: None,
        tokens: None,
        last_tool: None,
        agent: Some("antigravity".into()),
        parent_id: None,
        output: None,
    }
}

/// `Killed roles: A, B` in `manage_subagents`' output.
fn killed_roles(output: &str) -> Vec<&str> {
    output
        .lines()
        .find_map(|l| l.trim().strip_prefix("Killed roles:"))
        .map(|roles| roles.split(',').map(str::trim).filter(|r| !r.is_empty()).collect())
        .unwrap_or_default()
}

impl AntigravityParser {
    pub fn new(nonce: impl Into<String>) -> Self {
        Self {
            nonce: nonce.into(),
            texts: HashMap::new(),
            started_tools: HashSet::new(),
            finished_tools: HashSet::new(),
            turn_usage: TokenUsage::default(),
            subagents: Vec::new(),
        }
    }

    fn id(&self, step: u64) -> String {
        format!("agy:{}:{step}", self.nonce)
    }

    pub fn feed(&mut self, line: &str) -> Vec<AdapterEvent> {
        let line = line.trim();
        if line.is_empty() {
            return Vec::new();
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return vec![AdapterEvent::Warning(format!(
                "ligne non JSON : {}",
                line.chars().take(200).collect::<String>()
            ))];
        };
        match v.get("event").and_then(Value::as_str) {
            Some("init") => {
                let Some(session_ref) = v.get("conversation_id").and_then(Value::as_str) else { return Vec::new() };
                vec![AdapterEvent::SessionInit {
                    session_ref: session_ref.to_string(),
                    model: v.pointer("/init/model").and_then(Value::as_str).map(str::to_string),
                }]
            }
            Some("step_update") => v.get("step_update").map(|s| self.on_step(s)).unwrap_or_default(),
            Some("result") => self.on_result(v.get("result").unwrap_or(&Value::Null)),
            _ => Vec::new(),
        }
    }

    fn add_usage(&mut self, usage: Option<&Value>) {
        if let Some(u_) = usage {
            self.turn_usage.add(&TokenUsage {
                input: u(u_, "input_tokens"),
                output: u(u_, "output_tokens") + u(u_, "thinking_tokens"),
                cache_read: u(u_, "cache_read_tokens"),
                cache_write: 0,
                cost_usd: 0.0,
            });
        }
    }

    fn on_step(&mut self, s: &Value) -> Vec<AdapterEvent> {
        let step = s.get("step_index").and_then(Value::as_u64).unwrap_or(0);
        let state = s.get("state").and_then(Value::as_str).unwrap_or("");
        let done = state != "ACTIVE";
        let mut out = Vec::new();
        match s.get("step_type").and_then(Value::as_str) {
            Some("agent_response") => {
                if !done && !self.texts.contains_key(&step) {
                    out.push(AdapterEvent::Status { status: ThreadStatus::Thinking, detail: None });
                }
                if let Some(delta) = s.get("text_delta").and_then(Value::as_str).filter(|d| !d.is_empty()) {
                    self.texts.entry(step).or_default().push_str(delta);
                    out.push(AdapterEvent::TextDelta {
                        item_id: self.id(step),
                        channel: DeltaChannel::Text,
                        text: delta.to_string(),
                    });
                }
                if done {
                    self.add_usage(s.get("usage"));
                    if let Some(text) = self.texts.remove(&step).filter(|t| !t.trim().is_empty()) {
                        out.push(AdapterEvent::BlockCompleted {
                            item_id: self.id(step),
                            channel: DeltaChannel::Text,
                            text: text.trim_end().to_string(),
                        });
                    }
                }
            }
            Some("tool") => {
                let raw_name = s
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .or_else(|| s.pointer("/tool_info/name").and_then(Value::as_str))
                    .unwrap_or("outil");
                let raw_params = s.pointer("/tool_info/parameters").cloned().unwrap_or(Value::Null);
                let (name, input) = if raw_name == "call_mcp_tool" {
                    let server = raw_params.get("ServerName").and_then(Value::as_str).filter(|t| !t.is_empty());
                    let tool = raw_params.get("ToolName").and_then(Value::as_str).filter(|t| !t.is_empty());
                    match (server, tool) {
                        (Some(srv), Some(t)) => {
                            (format!("{srv}.{t}"), raw_params.get("Arguments").cloned().unwrap_or(Value::Null))
                        }
                        (None, Some(t)) => (t.to_string(), raw_params.get("Arguments").cloned().unwrap_or(Value::Null)),
                        _ => (raw_name.to_string(), raw_params),
                    }
                } else {
                    (raw_name.to_string(), raw_params)
                };
                if self.started_tools.insert(step) {
                    out.push(AdapterEvent::ToolCallStart {
                        id: self.id(step),
                        name: name.clone(),
                        input,
                        parent_id: None,
                    });
                }
                if done && self.finished_tools.insert(step) {
                    self.add_usage(s.get("usage"));
                    let is_error = state != "DONE";
                    let output = s.pointer("/tool_info/output").and_then(Value::as_str).unwrap_or_default();
                    if name == "manage_subagents" && !is_error {
                        let kill_all =
                            s.pointer("/tool_info/parameters/Action").and_then(Value::as_str) == Some("kill_all");
                        let roles = killed_roles(output);
                        out.extend(self.end_subagents(SubagentStatus::Completed, |role| {
                            kill_all || role.is_some_and(|r| roles.contains(&r))
                        }));
                    }
                    let err_text = s
                        .get("error")
                        .and_then(Value::as_str)
                        .or_else(|| s.pointer("/tool_info/error/message").and_then(Value::as_str))
                        .or_else(|| s.pointer("/tool_info/error").and_then(Value::as_str))
                        .filter(|e| !e.trim().is_empty())
                        .map(str::to_string);
                    out.push(AdapterEvent::ToolCallResult {
                        id: self.id(step),
                        output: err_text.unwrap_or_else(|| {
                            if is_error { crate::tr!("État : {state}", "State: {state}") } else { output.to_string() }
                        }),
                        is_error,
                    });
                    out.push(AdapterEvent::Status { status: ThreadStatus::Thinking, detail: None });
                }
            }
            Some("subagent") => {
                let launcher = self.id(step);
                let subs = s.pointer("/subagent_info/subagents").and_then(Value::as_array).cloned().unwrap_or_default();
                if self.started_tools.insert(step) {
                    out.push(AdapterEvent::ToolCallStart {
                        id: launcher.clone(),
                        name: s_(s, "tool_name").unwrap_or_else(|| "invoke_subagent".into()),
                        input: s.get("subagent_info").cloned().unwrap_or(Value::Null),
                        parent_id: None,
                    });
                    for (i, sub) in subs.iter().enumerate() {
                        let id = format!("{launcher}:{i}");
                        let role = s_(sub, "role");
                        self.subagents.push((id.clone(), role.clone()));
                        let mut event = subagent(id, SubagentStatus::Running);
                        if let AdapterEvent::Subagent { description, subagent_type, parent_id, output, .. } = &mut event
                        {
                            *description = role;
                            *subagent_type = s_(sub, "type_name");
                            *parent_id = Some(launcher.clone());
                            *output = s_(sub, "initial_prompt");
                        }
                        out.push(event);
                    }
                }
                if done && self.finished_tools.insert(step) {
                    self.add_usage(s.get("usage"));
                    let is_error = state != "DONE";
                    if is_error {
                        let prefix = format!("{launcher}:");
                        let ids: Vec<String> = self
                            .subagents
                            .iter()
                            .filter(|(id, _)| id.starts_with(&prefix))
                            .map(|(id, _)| id.clone())
                            .collect();
                        self.subagents.retain(|(id, _)| !ids.contains(id));
                        out.extend(ids.into_iter().map(|id| subagent(id, SubagentStatus::Failed)));
                    }
                    let roles: Vec<&str> =
                        subs.iter().filter_map(|sub| sub.get("role").and_then(Value::as_str)).collect();
                    out.push(AdapterEvent::ToolCallResult {
                        id: launcher,
                        output: s.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| {
                            if is_error { crate::tr!("État : {state}", "State: {state}") } else { roles.join(", ") }
                        }),
                        is_error,
                    });
                    out.push(AdapterEvent::Status { status: ThreadStatus::Thinking, detail: None });
                }
            }
            _ => {}
        }
        out
    }

    /// Ends the running sub-agents whose role matches.
    fn end_subagents(&mut self, status: SubagentStatus, matches: impl Fn(Option<&str>) -> bool) -> Vec<AdapterEvent> {
        let mut out = Vec::new();
        self.subagents.retain(|(id, role)| {
            let ends = matches(role.as_deref());
            if ends {
                out.push(subagent(id.clone(), status));
            }
            !ends
        });
        out
    }

    fn on_result(&mut self, r: &Value) -> Vec<AdapterEvent> {
        // Sub-agents still listed: the turn is over, so are they.
        let mut out = self.end_subagents(SubagentStatus::Completed, |_| true);
        let usage = std::mem::take(&mut self.turn_usage);
        self.texts.clear();
        let ok = r.get("status").and_then(Value::as_str) == Some("SUCCESS");
        let error = (!ok).then(|| {
            r.get("error").and_then(Value::as_str).filter(|e| !e.is_empty()).unwrap_or("Erreur Antigravity").to_string()
        });
        let duration_ms = r.get("duration_seconds").and_then(Value::as_f64).map(|s| (s * 1000.0) as i64);
        out.push(AdapterEvent::TurnComplete { usage, duration_ms, error });
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO_TURNS: &str = include_str!("fixtures/two_turns.jsonl");

    #[test]
    fn parses_tool_text_and_per_turn_usage() {
        let mut p = AntigravityParser::new("n");
        let events: Vec<AdapterEvent> = TWO_TURNS.lines().flat_map(|l| p.feed(l)).collect();

        assert!(matches!(&events[0], AdapterEvent::SessionInit { model: Some(m), .. } if m == "gemini-4-neon-low"));
        assert!(events.iter().any(|e| matches!(e, AdapterEvent::ToolCallStart { name, input, .. }
            if name == "write_file" && input["Path"].as_str().is_some_and(|p| p.ends_with("hi.txt")))));
        assert!(events.iter().any(|e| matches!(e, AdapterEvent::ToolCallResult { is_error: false, .. })));

        let texts: Vec<&str> = events
            .iter()
            .filter_map(|e| match e {
                AdapterEvent::BlockCompleted { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(texts, ["DONE", "SECOND"]);

        let turns: Vec<&TokenUsage> = events
            .iter()
            .filter_map(|e| match e {
                AdapterEvent::TurnComplete { usage, error: None, .. } => Some(usage),
                _ => None,
            })
            .collect();
        assert_eq!(turns.len(), 2);
        // Turn 2 counts only its own step (2137 input), not the cumulative session total.
        assert_eq!(turns[1].input, 2137);
        assert_eq!(turns[0].input, 10251 + 2452);
    }

    const SUBAGENTS: &str = include_str!("fixtures/subagents.jsonl");

    #[test]
    fn subagents_run_until_killed() {
        let mut parser = AntigravityParser::new("n");
        let events: Vec<AdapterEvent> = SUBAGENTS.lines().flat_map(|l| parser.feed(l)).collect();
        let launchers: Vec<&str> = events
            .iter()
            .filter_map(|e| match e {
                AdapterEvent::ToolCallStart { id, name, .. } if name == "invoke_subagent" => Some(id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(launchers, ["agy:n:2", "agy:n:3"]);
        let subs: Vec<(&str, SubagentStatus, Option<&str>)> = events
            .iter()
            .filter_map(|e| match e {
                AdapterEvent::Subagent { tool_call_id, status, description, agent, .. } => {
                    assert_eq!(agent.as_deref(), Some("antigravity"));
                    Some((tool_call_id.as_str(), *status, description.as_deref()))
                }
                _ => None,
            })
            .collect();
        assert_eq!(
            subs,
            [
                ("agy:n:2:0", SubagentStatus::Running, Some("Test Subagent 1")),
                ("agy:n:3:0", SubagentStatus::Running, Some("Test Subagent 2")),
                // `manage_subagents` kill_all.
                ("agy:n:2:0", SubagentStatus::Completed, None),
                ("agy:n:3:0", SubagentStatus::Completed, None),
            ]
        );
        assert!(events.iter().any(|e| matches!(e, AdapterEvent::Subagent {
            tool_call_id, subagent_type: Some(t), parent_id: Some(p), output: Some(o), ..
        } if tool_call_id == "agy:n:2:0" && t == "research" && p == "agy:n:2" && o.contains("OK"))));
        assert!(events.iter().any(|e| matches!(e, AdapterEvent::ToolCallResult { id, output, .. }
            if id == "agy:n:8" && output.contains("Successfully killed 2 subagent(s)"))));
        assert!(parser.subagents.is_empty());
    }

    #[test]
    fn subagents_end_with_the_turn_or_their_roles() {
        assert_eq!(
            killed_roles("Done\nKilled roles: Test Subagent 2, Test Subagent 1"),
            ["Test Subagent 2", "Test Subagent 1"]
        );
        let mut parser = AntigravityParser::new("n");
        let invoke = r#"{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"subagent","tool_name":"invoke_subagent","subagent_info":{"subagents":[{"role":"A"},{"role":"B"}]}}}"#;
        let kill = r#"{"event":"step_update","step_update":{"step_index":3,"state":"DONE","step_type":"tool","tool_name":"manage_subagents","tool_info":{"name":"manage_subagents","parameters":{"Action":"kill"},"output":"Killed roles: B"}}}"#;
        let ended = |events: Vec<AdapterEvent>| -> Vec<String> {
            events
                .into_iter()
                .filter_map(|e| match e {
                    AdapterEvent::Subagent { tool_call_id, status: SubagentStatus::Completed, .. } => {
                        Some(tool_call_id)
                    }
                    _ => None,
                })
                .collect()
        };
        assert_eq!(parser.feed(invoke).len(), 3);
        assert_eq!(ended(parser.feed(kill)), ["agy:n:2:1"]);
        assert_eq!(ended(parser.feed(r#"{"event":"result","result":{"status":"SUCCESS"}}"#)), ["agy:n:2:0"]);
    }

    #[test]
    fn failed_result_is_an_error() {
        let mut p = AntigravityParser::new("n");
        let ev = p.feed(r#"{"event":"result","result":{"status":"ERROR","error":"boom","usage":{}}}"#);
        assert!(matches!(ev.as_slice(), [AdapterEvent::TurnComplete { error: Some(e), .. }] if e == "boom"));
    }

    #[test]
    fn unwraps_call_mcp_tool_and_extracts_tool_error() {
        let mut p = AntigravityParser::new("n");
        let start = r#"{"event":"step_update","step_update":{"step_index":4,"state":"ACTIVE","step_type":"tool","tool_name":"call_mcp_tool","tool_info":{"name":"call_mcp_tool","parameters":{"Arguments":{"path":"test.txt"},"ServerName":"neuron_remote","ToolName":"remote_read"}}}}"#;
        let done = r#"{"event":"step_update","step_update":{"step_index":4,"state":"ERROR","step_type":"tool","tool_name":"call_mcp_tool","tool_info":{"name":"call_mcp_tool","parameters":{"Arguments":{"path":"test.txt"},"ServerName":"neuron_remote","ToolName":"remote_read"},"error":{"type":"TOOL_ERROR","message":"permission denied"}}}}"#;
        let ev1 = p.feed(start);
        assert!(matches!(
            ev1.as_slice(),
            [AdapterEvent::ToolCallStart { name, input, .. }]
                if name == "neuron_remote.remote_read" && input["path"] == "test.txt"
        ));
        let ev2 = p.feed(done);
        assert!(ev2.iter().any(|e| matches!(
            e,
            AdapterEvent::ToolCallResult { output, is_error: true, .. } if output == "permission denied"
        )));
    }
}
