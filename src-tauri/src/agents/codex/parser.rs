//! Pure parser for `codex exec --json` (one process per turn).
//!
//! Events: `thread.started` (thread id, used to resume), `turn.started`, `item.started` / `item.completed`
//! (`command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `reasoning`, `agent_message`, `error`),
//! `turn.completed` (usage) / `turn.failed`.

use std::collections::HashSet;

use serde_json::{Value, json};

use crate::agents::AdapterEvent;
use crate::agents::events::{DeltaChannel, ThreadStatus, TokenUsage};

#[derive(Debug)]
pub struct CodexParser {
    /// Unique per turn: Codex item ids (`item_0`…) restart every turn.
    nonce: String,
    started: HashSet<String>,
}

fn u(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// `"C:\…\powershell.exe" -Command 'echo hi'` → `echo hi`.
pub fn display_command(raw: &str) -> String {
    for marker in ["-Command '", "-c '", "-lc '"] {
        if let Some(i) = raw.find(marker) {
            let inner = &raw[i + marker.len()..];
            return inner.strip_suffix('\'').unwrap_or(inner).to_string();
        }
    }
    raw.to_string()
}

/// Codex error payloads are often a JSON string with a nested `error.message`.
fn error_message(raw: &str) -> String {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| raw.to_string())
}

impl CodexParser {
    pub fn new(nonce: impl Into<String>) -> Self {
        Self { nonce: nonce.into(), started: HashSet::new() }
    }

    fn id(&self, item: &Value) -> String {
        format!("codex:{}:{}", self.nonce, item.get("id").and_then(Value::as_str).unwrap_or("?"))
    }

    pub fn feed(&mut self, line: &str) -> Vec<AdapterEvent> {
        let line = line.trim();
        if line.is_empty() {
            return Vec::new();
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return vec![AdapterEvent::Warning(format!("ligne non JSON : {}", line.chars().take(200).collect::<String>()))];
        };
        match v.get("type").and_then(Value::as_str) {
            Some("thread.started") => v
                .get("thread_id")
                .and_then(Value::as_str)
                .map(|id| vec![AdapterEvent::SessionInit { session_ref: id.to_string(), model: None }])
                .unwrap_or_default(),
            Some("turn.started") => vec![AdapterEvent::Status { status: ThreadStatus::Thinking, detail: None }],
            Some("item.started") => v.get("item").map(|i| self.on_item(i, false)).unwrap_or_default(),
            Some("item.completed") => v.get("item").map(|i| self.on_item(i, true)).unwrap_or_default(),
            Some("turn.completed") => {
                let usage = v.get("usage").cloned().unwrap_or(Value::Null);
                let input = u(&usage, "input_tokens");
                let cached = u(&usage, "cached_input_tokens");
                vec![AdapterEvent::TurnComplete {
                    usage: TokenUsage {
                        input: input.saturating_sub(cached),
                        output: u(&usage, "output_tokens") + u(&usage, "reasoning_output_tokens"),
                        cache_read: cached,
                        cache_write: u(&usage, "cache_write_input_tokens"),
                        cost_usd: 0.0,
                    },
                    duration_ms: None,
                    error: None,
                }]
            }
            Some("turn.failed") => vec![AdapterEvent::TurnComplete {
                usage: TokenUsage::default(),
                duration_ms: None,
                error: Some(error_message(
                    v.pointer("/error/message").and_then(Value::as_str).unwrap_or("Échec du tour Codex"),
                )),
            }],
            Some("error") => vec![AdapterEvent::Warning(
                v.get("message").and_then(Value::as_str).map(error_message).unwrap_or_default(),
            )],
            _ => Vec::new(),
        }
    }

    fn tool(&mut self, id: String, name: &str, input: Value) -> Vec<AdapterEvent> {
        if self.started.insert(id.clone()) {
            vec![AdapterEvent::ToolCallStart { id, name: name.to_string(), input }]
        } else {
            Vec::new()
        }
    }

    fn on_item(&mut self, item: &Value, completed: bool) -> Vec<AdapterEvent> {
        let id = self.id(item);
        let failed = item.get("status").and_then(Value::as_str) == Some("failed");
        match item.get("type").and_then(Value::as_str) {
            Some("command_execution") => {
                let command = display_command(item.get("command").and_then(Value::as_str).unwrap_or(""));
                let mut out = self.tool(id.clone(), "Shell", json!({ "command": command }));
                if completed {
                    let exit = item.get("exit_code").and_then(Value::as_i64);
                    out.push(AdapterEvent::ToolCallResult {
                        id,
                        output: item.get("aggregated_output").and_then(Value::as_str).unwrap_or("").to_string(),
                        is_error: failed || exit.is_some_and(|c| c != 0),
                    });
                    out.push(AdapterEvent::Status { status: ThreadStatus::Thinking, detail: None });
                }
                out
            }
            Some("file_change") => {
                let mut out = self.tool(id.clone(), "FileChange", json!({ "changes": item.get("changes").cloned().unwrap_or(Value::Null) }));
                if completed {
                    let summary = item
                        .get("changes")
                        .and_then(Value::as_array)
                        .map(|cs| {
                            cs.iter()
                                .filter_map(|c| {
                                    Some(format!("{} {}", c.get("kind")?.as_str()?, c.get("path")?.as_str()?))
                                })
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_default();
                    out.push(AdapterEvent::ToolCallResult { id, output: summary, is_error: failed });
                }
                out
            }
            Some("mcp_tool_call") => {
                let name = format!(
                    "{}.{}",
                    item.get("server").and_then(Value::as_str).unwrap_or("mcp"),
                    item.get("tool").and_then(Value::as_str).unwrap_or("outil")
                );
                let mut out = self.tool(id.clone(), &name, item.get("arguments").cloned().unwrap_or(Value::Null));
                if completed {
                    out.push(AdapterEvent::ToolCallResult {
                        id,
                        output: item.get("result").map(|r| r.to_string()).unwrap_or_default(),
                        is_error: failed || item.get("error").is_some_and(|e| !e.is_null()),
                    });
                }
                out
            }
            Some("web_search") => {
                let mut out = self.tool(id.clone(), "WebSearch", json!({ "query": item.get("query") }));
                if completed {
                    out.push(AdapterEvent::ToolCallResult { id, output: String::new(), is_error: false });
                }
                out
            }
            Some(kind @ ("agent_message" | "reasoning")) if completed => {
                let text = item.get("text").and_then(Value::as_str).unwrap_or("").to_string();
                if text.trim().is_empty() {
                    return Vec::new();
                }
                let channel = if kind == "agent_message" { DeltaChannel::Text } else { DeltaChannel::Thinking };
                vec![
                    AdapterEvent::TextDelta { item_id: id.clone(), channel, text: text.clone() },
                    AdapterEvent::BlockCompleted { item_id: id, channel, text },
                ]
            }
            Some("error") if completed => vec![AdapterEvent::Warning(
                item.get("message").and_then(Value::as_str).unwrap_or("").to_string(),
            )],
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(fixture: &str) -> Vec<AdapterEvent> {
        let mut p = CodexParser::new("n");
        fixture.lines().flat_map(|l| p.feed(l)).collect()
    }

    #[test]
    fn parses_commands_message_and_usage() {
        let events = run(include_str!("fixtures/turn_tools.jsonl"));
        assert!(matches!(&events[0], AdapterEvent::SessionInit { session_ref, .. } if !session_ref.is_empty()));
        let commands: Vec<String> = events
            .iter()
            .filter_map(|e| match e {
                AdapterEvent::ToolCallStart { input, .. } => input["command"].as_str().map(str::to_string),
                _ => None,
            })
            .collect();
        assert_eq!(commands[0], "echo neuron-probe");
        assert!(events.iter().any(|e| matches!(e, AdapterEvent::ToolCallResult { output, is_error: false, .. } if output.contains("neuron-probe"))));
        assert!(events.iter().any(|e| matches!(e, AdapterEvent::BlockCompleted { text, .. } if text == "DONE")));
        let usage = events.iter().find_map(|e| match e {
            AdapterEvent::TurnComplete { usage, error: None, .. } => Some(*usage),
            _ => None,
        });
        let usage = usage.expect("turn completed");
        assert_eq!(usage.cache_read, 28416);
        assert_eq!(usage.input, 43345 - 28416);
    }

    #[test]
    fn failed_turn_extracts_message() {
        let events = run(include_str!("fixtures/turn_failed.jsonl"));
        let err = events.iter().find_map(|e| match e {
            AdapterEvent::TurnComplete { error: Some(e), .. } => Some(e.clone()),
            _ => None,
        });
        assert!(err.expect("error").contains("not supported"), "nested message is extracted");
    }

    #[test]
    fn command_display() {
        assert_eq!(display_command(r#""C:\ps.exe" -Command 'npm test'"#), "npm test");
        assert_eq!(display_command("ls -la"), "ls -la");
    }
}
