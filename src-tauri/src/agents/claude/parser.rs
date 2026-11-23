//! Pure parser for Claude Code `--output-format stream-json --verbose --include-partial-messages` output.
//! One line in → zero or more [`AdapterEvent`]s out. No I/O, fully unit-tested against captured sessions.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::agents::events::{DeltaChannel, SubagentStatus, ThreadStatus, TokenUsage};
use crate::agents::{AdapterEvent, RateLimitWindow};

#[derive(Debug)]
struct Block {
    channel: DeltaChannel,
    text: String,
}

#[derive(Debug, Default)]
pub struct ClaudeParser {
    /// Message id of the message currently being streamed (from `message_start`).
    current_message: Option<String>,
    /// Streaming text/thinking blocks, keyed by item id (`<message id>:<block index>`).
    blocks: HashMap<String, Block>,
    /// Messages whose text arrived through stream deltas (their full `assistant` copy is then ignored).
    streamed_messages: HashSet<String>,
    /// Tool calls already announced (assistant events can repeat content).
    started_tools: HashSet<String>,
    /// Text of `<synthetic>` messages (written by the CLI, not the model), held until the `result` says whether
    /// it was a local command's output (`local_command`) or an ordinary notice. `(item id, text)`.
    synthetic: Vec<(String, String)>,
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

fn u(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Text of a `tool_result.content` (string, or array of `{type:"text", text}` parts).
fn tool_result_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

impl ClaudeParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, line: &str) -> Vec<AdapterEvent> {
        let line = line.trim();
        if line.is_empty() {
            return Vec::new();
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return vec![AdapterEvent::Warning(format!("ligne non JSON : {}", truncate(line, 200)))],
        };
        match value.get("type").and_then(Value::as_str) {
            Some("system") => self.on_system(&value),
            Some("stream_event") => value.get("event").map(|e| self.on_stream_event(e)).unwrap_or_default(),
            Some("assistant") => self.on_assistant(&value),
            Some("user") => self.on_user(&value),
            Some("control_request") => self.on_control_request(&value),
            Some("result") => self.on_result(&value),
            Some("rate_limit_event") => self.on_rate_limit(&value),
            _ => Vec::new(), // control_response, keep_alive, hook events…
        }
    }

    fn on_system(&mut self, v: &Value) -> Vec<AdapterEvent> {
        match v.get("subtype").and_then(Value::as_str) {
            Some("init") => match s(v, "session_id") {
                Some(session_ref) => vec![AdapterEvent::SessionInit { session_ref, model: s(v, "model") }],
                None => Vec::new(),
            },
            Some("status") if v.get("status").and_then(Value::as_str) == Some("requesting") => {
                vec![AdapterEvent::Status { status: ThreadStatus::Thinking, detail: None }]
            }
            Some(sub @ ("task_started" | "task_progress" | "task_notification")) => self.on_task(sub, v),
            _ => Vec::new(),
        }
    }

    /// Sub-agent lifecycle (`task_started` / `task_progress` / `task_notification`).
    fn on_task(&mut self, subtype: &str, v: &Value) -> Vec<AdapterEvent> {
        let Some(tool_call_id) = s(v, "tool_use_id") else { return Vec::new() };
        let status = match (subtype, v.get("status").and_then(Value::as_str)) {
            ("task_notification", Some("completed")) => SubagentStatus::Completed,
            ("task_notification", _) => SubagentStatus::Failed,
            _ => SubagentStatus::Running,
        };
        let usage = v.get("usage");
        vec![AdapterEvent::Subagent {
            tool_call_id,
            description: s(v, "description"),
            subagent_type: s(v, "subagent_type"),
            status,
            tool_uses: usage.and_then(|u| u.get("tool_uses")).and_then(Value::as_u64),
            tokens: usage.and_then(|u| u.get("total_tokens")).and_then(Value::as_u64),
            last_tool: s(v, "last_tool_name"),
        }]
    }

    fn on_stream_event(&mut self, e: &Value) -> Vec<AdapterEvent> {
        let index = e.get("index").and_then(Value::as_u64);
        match e.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                self.current_message = e.get("message").and_then(|m| s(m, "id"));
                Vec::new()
            }
            Some("content_block_start") => {
                let (Some(msg), Some(index)) = (self.current_message.clone(), index) else {
                    return Vec::new();
                };
                let kind = e.get("content_block").and_then(|b| s(b, "type"));
                let channel = match kind.as_deref() {
                    Some("text") => DeltaChannel::Text,
                    Some("thinking") => DeltaChannel::Thinking,
                    _ => return Vec::new(),
                };
                self.blocks.insert(format!("{msg}:{index}"), Block { channel, text: String::new() });
                Vec::new()
            }
            Some("content_block_delta") => {
                let (Some(msg), Some(index)) = (self.current_message.clone(), index) else {
                    return Vec::new();
                };
                let Some(delta) = e.get("delta") else { return Vec::new() };
                let (channel, text) = match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => (DeltaChannel::Text, s(delta, "text")),
                    Some("thinking_delta") => (DeltaChannel::Thinking, s(delta, "thinking")),
                    _ => return Vec::new(),
                };
                let Some(text) = text.filter(|t| !t.is_empty()) else { return Vec::new() };
                let item_id = format!("{msg}:{index}");
                self.streamed_messages.insert(msg);
                self.blocks
                    .entry(item_id.clone())
                    .or_insert_with(|| Block { channel, text: String::new() })
                    .text
                    .push_str(&text);
                vec![AdapterEvent::TextDelta { item_id, channel, text }]
            }
            Some("content_block_stop") => {
                let (Some(msg), Some(index)) = (self.current_message.clone(), index) else {
                    return Vec::new();
                };
                match self.blocks.remove(&format!("{msg}:{index}")) {
                    Some(block) if !block.text.trim().is_empty() => vec![AdapterEvent::BlockCompleted {
                        item_id: format!("{msg}:{index}"),
                        channel: block.channel,
                        text: block.text,
                    }],
                    _ => Vec::new(),
                }
            }
            _ => Vec::new(),
        }
    }

    fn on_assistant(&mut self, v: &Value) -> Vec<AdapterEvent> {
        let Some(message) = v.get("message") else { return Vec::new() };
        let msg_id = s(message, "id").unwrap_or_default();
        let streamed = self.streamed_messages.contains(&msg_id);
        // Messages written by a sub-agent carry the id of the call that launched it.
        let parent = s(v, "parent_tool_use_id");
        let synthetic = s(message, "model").as_deref() == Some("<synthetic>") && parent.is_none() && !streamed;
        let mut out = if synthetic { Vec::new() } else { self.flush_synthetic() };
        let Some(content) = message.get("content").and_then(Value::as_array) else { return out };
        for (n, block) in content.iter().enumerate() {
            match block.get("type").and_then(Value::as_str) {
                Some("tool_use") => {
                    let Some(id) = s(block, "id") else { continue };
                    if !self.started_tools.insert(id.clone()) {
                        continue;
                    }
                    out.push(AdapterEvent::ToolCallStart {
                        id,
                        name: s(block, "name").unwrap_or_else(|| "outil".into()),
                        input: block.get("input").cloned().unwrap_or(Value::Null),
                        parent_id: parent.clone(),
                    });
                }
                // Fallback when partial messages are not streamed. A sub-agent's own text is not the answer:
                // it reaches the conversation through the launching tool's result.
                Some(kind @ ("text" | "thinking")) if !streamed && parent.is_none() => {
                    let channel = if kind == "text" { DeltaChannel::Text } else { DeltaChannel::Thinking };
                    let text = s(block, kind).unwrap_or_default();
                    if text.trim().is_empty() {
                        continue;
                    }
                    let item_id = format!("{msg_id}:a{n}");
                    if synthetic && kind == "text" {
                        self.synthetic.push((item_id, text));
                        continue;
                    }
                    out.push(AdapterEvent::TextDelta { item_id: item_id.clone(), channel, text: text.clone() });
                    out.push(AdapterEvent::BlockCompleted { item_id, channel, text });
                }
                _ => {}
            }
        }
        out
    }

    fn on_user(&mut self, v: &Value) -> Vec<AdapterEvent> {
        let Some(content) = v.get("message").and_then(|m| m.get("content")).and_then(Value::as_array) else {
            return Vec::new();
        };
        let mut out: Vec<AdapterEvent> = content
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
            .filter_map(|b| {
                Some(AdapterEvent::ToolCallResult {
                    id: s(b, "tool_use_id")?,
                    output: tool_result_text(b.get("content").unwrap_or(&Value::Null)),
                    is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                })
            })
            .collect();
        if !out.is_empty() {
            out.push(AdapterEvent::Status { status: ThreadStatus::Thinking, detail: None });
        }
        out
    }

    fn on_control_request(&mut self, v: &Value) -> Vec<AdapterEvent> {
        let Some(req) = v.get("request") else { return Vec::new() };
        if req.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
            return Vec::new();
        }
        let Some(request_id) = s(v, "request_id") else { return Vec::new() };
        let tool_name = s(req, "tool_name").unwrap_or_else(|| "outil".into());
        vec![AdapterEvent::PermissionRequest {
            description: s(req, "description").unwrap_or_else(|| tool_name.clone()),
            tool_name,
            request_id,
            input: req.get("input").cloned().unwrap_or(Value::Null),
            tool_use_id: s(req, "tool_use_id"),
        }]
    }

    /// Held `<synthetic>` text, emitted as ordinary assistant text.
    fn flush_synthetic(&mut self) -> Vec<AdapterEvent> {
        self.synthetic
            .drain(..)
            .flat_map(|(item_id, text)| {
                [
                    AdapterEvent::TextDelta { item_id: item_id.clone(), channel: DeltaChannel::Text, text: text.clone() },
                    AdapterEvent::BlockCompleted { item_id, channel: DeltaChannel::Text, text },
                ]
            })
            .collect()
    }

    fn on_result(&mut self, v: &Value) -> Vec<AdapterEvent> {
        self.current_message = None;
        self.blocks.clear();
        // Local slash command (`/usage`, `/context`…): its synthetic message is the command's output.
        let mut out = match s(v, "local_command").filter(|n| !n.is_empty()) {
            Some(name) => {
                let held = std::mem::take(&mut self.synthetic);
                let item_id = held.first().map(|(id, _)| id.clone()).unwrap_or_else(|| format!("cmd-{name}-{}", s(v, "uuid").unwrap_or_default()));
                let text = held.into_iter().map(|(_, t)| t).collect::<Vec<_>>().join("

");
                vec![AdapterEvent::CommandOutput { item_id, name: name.trim_start_matches('/').to_string(), text }]
            }
            None => self.flush_synthetic(),
        };
        let usage = v.get("usage").cloned().unwrap_or(Value::Null);
        let tokens = TokenUsage {
            input: u(&usage, "input_tokens"),
            output: u(&usage, "output_tokens"),
            cache_read: u(&usage, "cache_read_input_tokens"),
            cache_write: u(&usage, "cache_creation_input_tokens"),
            cost_usd: v.get("total_cost_usd").and_then(Value::as_f64).unwrap_or(0.0),
        };
        let is_error = v.get("is_error").and_then(Value::as_bool).unwrap_or(false)
            || v.get("subtype").and_then(Value::as_str).is_some_and(|st| st != "success");
        let error = is_error.then(|| {
            s(v, "result")
                .filter(|r| !r.trim().is_empty())
                .or_else(|| s(v, "subtype"))
                .unwrap_or_else(|| "Erreur inconnue".into())
        });
        out.push(AdapterEvent::TurnComplete {
            usage: tokens,
            duration_ms: v.get("duration_ms").and_then(Value::as_i64),
            error,
        });
        out
    }

    fn on_rate_limit(&mut self, v: &Value) -> Vec<AdapterEvent> {
        let Some(windows) = v
            .get("rate_limit_info")
            .and_then(|i| i.get("unifiedWindows"))
            .and_then(Value::as_object)
        else {
            return Vec::new();
        };
        let list: Vec<RateLimitWindow> = windows
            .iter()
            .filter_map(|(name, w)| {
                Some(RateLimitWindow {
                    window: name.clone(),
                    utilization: w.get("utilization").and_then(Value::as_f64)?,
                    resets_at: w.get("resetsAt").and_then(Value::as_i64).map(|secs| secs * 1000),
                })
            })
            .collect();
        if list.is_empty() { Vec::new() } else { vec![AdapterEvent::RateLimits(list)] }
    }
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(fixture: &str) -> Vec<AdapterEvent> {
        let mut parser = ClaudeParser::new();
        fixture.lines().flat_map(|l| parser.feed(l)).collect()
    }

    const BASH: &str = include_str!("fixtures/bash_two_turns.jsonl");
    const PERMISSION: &str = include_str!("fixtures/permission_write.jsonl");
    const SUBAGENT: &str = include_str!("fixtures/subagent.jsonl");
    const LOCAL_COMMAND: &str = include_str!("fixtures/local_command.jsonl");

    #[test]
    fn local_command_output_is_not_assistant_text() {
        let events = run(LOCAL_COMMAND);
        assert!(events.iter().any(|e| matches!(e,
            AdapterEvent::CommandOutput { name, text, .. } if name == "usage" && text.contains("Current session"))));
        assert!(!events.iter().any(|e| matches!(e, AdapterEvent::TextDelta { .. } | AdapterEvent::BlockCompleted { .. })));
        assert!(matches!(events.last(), Some(AdapterEvent::TurnComplete { error: None, .. })));
    }

    #[test]
    fn synthetic_notice_without_local_command_stays_text() {
        let mut p = ClaudeParser::new();
        let mut events = p.feed(r#"{"type":"assistant","message":{"id":"s1","model":"<synthetic>","content":[{"type":"text","text":"No response requested."}]}}"#);
        assert!(events.is_empty());
        events.extend(p.feed(r#"{"type":"result","subtype":"success","is_error":false,"result":"","usage":{}}"#));
        assert!(matches!(&events[1], AdapterEvent::BlockCompleted { text, .. } if text == "No response requested."));
        assert!(matches!(events.last(), Some(AdapterEvent::TurnComplete { .. })));
    }

    #[test]
    fn subagent_calls_are_attached_to_their_launcher() {
        let events = run(SUBAGENT);
        let launcher = events
            .iter()
            .find_map(|e| match e {
                AdapterEvent::ToolCallStart { id, name, parent_id: None, .. } if name == "Agent" => Some(id.clone()),
                _ => None,
            })
            .expect("Agent call");
        // The sub-agent's own Read is attached to the Agent call.
        assert!(events.iter().any(|e| matches!(e,
            AdapterEvent::ToolCallStart { name, parent_id: Some(p), .. } if name == "Read" && *p == launcher)));
        // Lifecycle: started → progress → completed, all on the launcher id.
        let statuses: Vec<SubagentStatus> = events
            .iter()
            .filter_map(|e| match e {
                AdapterEvent::Subagent { tool_call_id, status, .. } if *tool_call_id == launcher => Some(*status),
                _ => None,
            })
            .collect();
        assert_eq!(statuses.first(), Some(&SubagentStatus::Running));
        assert_eq!(statuses.last(), Some(&SubagentStatus::Completed));
        assert!(events.iter().any(|e| matches!(e,
            AdapterEvent::Subagent { tool_uses: Some(1), last_tool: Some(t), .. } if t == "Read")));
        // The final answer is still the main agent's.
        assert!(events.iter().any(|e| matches!(e, AdapterEvent::BlockCompleted { text, .. } if text.contains("hello"))));
    }

    #[test]
    fn parses_tool_turn_and_second_turn() {
        let events = run(BASH);

        assert!(matches!(&events[0], AdapterEvent::SessionInit { session_ref, .. } if !session_ref.is_empty()));

        let tool_start = events.iter().find_map(|e| match e {
            AdapterEvent::ToolCallStart { id, name, input, .. } => Some((id.clone(), name.clone(), input.clone())),
            _ => None,
        });
        let (tool_id, name, input) = tool_start.expect("tool start");
        assert_eq!(name, "Bash");
        assert_eq!(input["command"], "echo neuron-probe");

        assert!(events.iter().any(|e| matches!(e,
            AdapterEvent::ToolCallResult { id, output, is_error: false } if *id == tool_id && output.contains("neuron-probe"))));

        let texts: Vec<&str> = events
            .iter()
            .filter_map(|e| match e {
                AdapterEvent::BlockCompleted { channel: DeltaChannel::Text, text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(texts, ["DONE", "SECOND"], "one completed text block per turn, no duplicates");

        let turns: Vec<&TokenUsage> = events
            .iter()
            .filter_map(|e| match e {
                AdapterEvent::TurnComplete { usage, error: None, .. } => Some(usage),
                _ => None,
            })
            .collect();
        assert_eq!(turns.len(), 2);
        assert!(turns[0].cache_read > 0 && turns[0].output > 0 && turns[0].cost_usd > 0.0);

        assert!(events.iter().any(|e| matches!(e, AdapterEvent::RateLimits(w) if w.iter().any(|w| w.window == "five_hour"))));
    }

    #[test]
    fn deltas_concatenate_to_completed_block() {
        let events = run(BASH);
        let mut streamed: HashMap<String, String> = HashMap::new();
        for e in &events {
            if let AdapterEvent::TextDelta { item_id, text, .. } = e {
                streamed.entry(item_id.clone()).or_default().push_str(text);
            }
        }
        for e in &events {
            if let AdapterEvent::BlockCompleted { item_id, text, .. } = e {
                assert_eq!(streamed.get(item_id), Some(text));
            }
        }
    }

    #[test]
    fn parses_permission_request() {
        let events = run(PERMISSION);
        let perm = events.iter().find_map(|e| match e {
            AdapterEvent::PermissionRequest { request_id, tool_name, input, tool_use_id, .. } => {
                Some((request_id.clone(), tool_name.clone(), input.clone(), tool_use_id.clone()))
            }
            _ => None,
        });
        let (request_id, tool_name, input, tool_use_id) = perm.expect("permission request");
        assert!(!request_id.is_empty());
        assert_eq!(tool_name, "Write");
        assert_eq!(input["content"], "hi");
        assert!(tool_use_id.is_some());
    }

    #[test]
    fn tolerates_garbage_and_errors() {
        let mut p = ClaudeParser::new();
        assert!(matches!(p.feed("not json").as_slice(), [AdapterEvent::Warning(_)]));
        assert!(p.feed("").is_empty());
        let err = p.feed(r#"{"type":"result","subtype":"error_during_execution","is_error":true,"usage":{}}"#);
        assert!(matches!(err.as_slice(), [AdapterEvent::TurnComplete { error: Some(e), .. }] if e == "error_during_execution"));
    }
}
