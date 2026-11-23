//! Pure parser for Antigravity (`agy`) `--output-format stream-json` output.
//!
//! Events: `init` (conversation id, model), `step_update` (user_input | agent_response with `text_delta` |
//! tool with `tool_info`; state ACTIVE → DONE; per-step `usage`), `result` (end of turn; its usage is
//! cumulative over the session, so per-turn usage is summed from the steps instead).

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::agents::AdapterEvent;
use crate::agents::events::{DeltaChannel, ThreadStatus, TokenUsage};

#[derive(Debug)]
pub struct AntigravityParser {
    /// Unique per process: step indexes may restart when a conversation is resumed.
    nonce: String,
    texts: HashMap<u64, String>,
    started_tools: HashSet<u64>,
    finished_tools: HashSet<u64>,
    turn_usage: TokenUsage,
}

fn u(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

impl AntigravityParser {
    pub fn new(nonce: impl Into<String>) -> Self {
        Self {
            nonce: nonce.into(),
            texts: HashMap::new(),
            started_tools: HashSet::new(),
            finished_tools: HashSet::new(),
            turn_usage: TokenUsage::default(),
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
                let name = s
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .or_else(|| s.pointer("/tool_info/name").and_then(Value::as_str))
                    .unwrap_or("outil")
                    .to_string();
                if self.started_tools.insert(step) {
                    out.push(AdapterEvent::ToolCallStart {
                        id: self.id(step),
                        name,
                        input: s.pointer("/tool_info/parameters").cloned().unwrap_or(Value::Null),
                        parent_id: None,
                    });
                }
                if done && self.finished_tools.insert(step) {
                    self.add_usage(s.get("usage"));
                    let is_error = state != "DONE";
                    out.push(AdapterEvent::ToolCallResult {
                        id: self.id(step),
                        output: s
                            .get("error")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                            .unwrap_or_else(|| if is_error { format!("État : {state}") } else { String::new() }),
                        is_error,
                    });
                    out.push(AdapterEvent::Status { status: ThreadStatus::Thinking, detail: None });
                }
            }
            _ => {}
        }
        out
    }

    fn on_result(&mut self, r: &Value) -> Vec<AdapterEvent> {
        let usage = std::mem::take(&mut self.turn_usage);
        self.texts.clear();
        let ok = r.get("status").and_then(Value::as_str) == Some("SUCCESS");
        let error = (!ok).then(|| {
            r.get("error").and_then(Value::as_str).filter(|e| !e.is_empty()).unwrap_or("Erreur Antigravity").to_string()
        });
        let duration_ms = r.get("duration_seconds").and_then(Value::as_f64).map(|s| (s * 1000.0) as i64);
        vec![AdapterEvent::TurnComplete { usage, duration_ms, error }]
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

    #[test]
    fn failed_result_is_an_error() {
        let mut p = AntigravityParser::new("n");
        let ev = p.feed(r#"{"event":"result","result":{"status":"ERROR","error":"boom","usage":{}}}"#);
        assert!(matches!(ev.as_slice(), [AdapterEvent::TurnComplete { error: Some(e), .. }] if e == "boom"));
    }
}
